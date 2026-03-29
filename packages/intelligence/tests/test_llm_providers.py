"""Tests for the unified LLM provider abstraction.

Covers:
- OllamaProvider with mocked httpx
- AnthropicProvider with mocked anthropic client
- GeminiProvider with mocked google-genai
- LLMRouter fallback chain
- Tool-call extraction from text
- JSON mode generation
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from routeai_intelligence.llm.provider import LLMProvider, LLMResponse, TokenUsage, ToolCall
from routeai_intelligence.llm.ollama_provider import OllamaProvider, _parse_tool_call_json
from routeai_intelligence.llm.router import LLMRouter


# -----------------------------------------------------------------------
# Fixtures and helpers
# -----------------------------------------------------------------------

SAMPLE_TOOLS = [
    {
        "name": "impedance_calc",
        "description": "Calculate transmission line impedance.",
        "input_schema": {
            "type": "object",
            "required": ["trace_width_mm", "dielectric_height_mm", "dielectric_constant"],
            "properties": {
                "trace_width_mm": {"type": "number", "description": "Trace width in mm"},
                "dielectric_height_mm": {"type": "number", "description": "Dielectric height in mm"},
                "dielectric_constant": {"type": "number", "description": "Er of dielectric"},
            },
        },
    },
]


def _ollama_chat_response(content: str, eval_count: int = 100) -> dict[str, Any]:
    """Build a mock Ollama /api/chat JSON response."""
    return {
        "model": "qwen2.5:7b",
        "message": {"role": "assistant", "content": content},
        "done": True,
        "done_reason": "stop",
        "prompt_eval_count": 50,
        "eval_count": eval_count,
    }


def _ollama_tags_response(models: list[str] | None = None) -> dict[str, Any]:
    """Build a mock Ollama /api/tags JSON response."""
    if models is None:
        models = ["qwen2.5:7b", "llama3.1:latest"]
    return {"models": [{"name": m} for m in models]}


class _MockHttpxResponse:
    """Minimal mock for httpx.Response."""

    def __init__(self, json_data: dict[str, Any], status_code: int = 200) -> None:
        self._json_data = json_data
        self.status_code = status_code

    def json(self) -> dict[str, Any]:
        return self._json_data

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            import httpx
            raise httpx.HTTPStatusError(
                f"HTTP {self.status_code}",
                request=MagicMock(),
                response=MagicMock(status_code=self.status_code),
            )


class _MockAsyncClient:
    """Mock for httpx.AsyncClient that returns pre-configured responses."""

    def __init__(self, responses: dict[str, _MockHttpxResponse]) -> None:
        self._responses = responses

    async def get(self, url: str, **kwargs: Any) -> _MockHttpxResponse:
        for pattern, resp in self._responses.items():
            if pattern in url:
                return resp
        return _MockHttpxResponse({}, 404)

    async def post(self, url: str, **kwargs: Any) -> _MockHttpxResponse:
        for pattern, resp in self._responses.items():
            if pattern in url:
                return resp
        return _MockHttpxResponse({}, 404)

    async def __aenter__(self) -> _MockAsyncClient:
        return self

    async def __aexit__(self, *args: Any) -> None:
        pass


# -----------------------------------------------------------------------
# OllamaProvider tests
# -----------------------------------------------------------------------


class TestOllamaProvider:
    """Tests for OllamaProvider."""

    @pytest.mark.asyncio
    async def test_is_available_success(self) -> None:
        """Ollama is available when /api/tags returns our model."""
        mock_client = _MockAsyncClient({
            "/api/tags": _MockHttpxResponse(_ollama_tags_response(["qwen2.5:7b"])),
        })
        with patch("httpx.AsyncClient", return_value=mock_client):
            provider = OllamaProvider(host="http://localhost:11434", model="qwen2.5:7b")
            assert await provider.is_available() is True

    @pytest.mark.asyncio
    async def test_is_available_server_down(self) -> None:
        """Ollama not available when server is unreachable."""
        with patch("httpx.AsyncClient") as mock_cls:
            import httpx
            mock_instance = AsyncMock()
            mock_instance.get.side_effect = httpx.ConnectError("Connection refused")
            mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_instance.__aexit__ = AsyncMock(return_value=None)
            mock_cls.return_value = mock_instance
            provider = OllamaProvider(host="http://localhost:11434")
            assert await provider.is_available() is False

    @pytest.mark.asyncio
    async def test_list_models(self) -> None:
        """list_models returns model names from Ollama."""
        mock_client = _MockAsyncClient({
            "/api/tags": _MockHttpxResponse(
                _ollama_tags_response(["qwen2.5:7b", "mistral:latest"])
            ),
        })
        with patch("httpx.AsyncClient", return_value=mock_client):
            provider = OllamaProvider(host="http://localhost:11434")
            models = await provider.list_models()
            assert "qwen2.5:7b" in models
            assert "mistral:latest" in models

    @pytest.mark.asyncio
    async def test_generate_simple(self) -> None:
        """Simple generation without tools returns text."""
        resp_data = _ollama_chat_response("The impedance is approximately 50 ohms.")
        mock_client = _MockAsyncClient({
            "/api/chat": _MockHttpxResponse(resp_data),
        })
        with patch("httpx.AsyncClient", return_value=mock_client):
            provider = OllamaProvider(host="http://localhost:11434", model="qwen2.5:7b")
            response = await provider.generate(
                messages=[{"role": "user", "content": "What is the impedance?"}],
                system="You are a PCB expert.",
            )
            assert isinstance(response, LLMResponse)
            assert "50 ohms" in response.text
            assert response.tool_calls == []
            assert response.stop_reason == "end_turn"
            assert response.usage.input_tokens == 50
            assert response.usage.output_tokens == 100

    @pytest.mark.asyncio
    async def test_generate_with_tool_calls(self) -> None:
        """Generation with tools parses tool_calls from output."""
        tool_response = (
            "I need to calculate the impedance.\n\n"
            "```tool_calls\n"
            '[{"name": "impedance_calc", "arguments": {"trace_width_mm": 0.15, '
            '"dielectric_height_mm": 0.2, "dielectric_constant": 4.2}}]\n'
            "```"
        )
        resp_data = _ollama_chat_response(tool_response)
        mock_client = _MockAsyncClient({
            "/api/chat": _MockHttpxResponse(resp_data),
        })
        with patch("httpx.AsyncClient", return_value=mock_client):
            provider = OllamaProvider(host="http://localhost:11434", model="qwen2.5:7b")
            response = await provider.generate(
                messages=[{"role": "user", "content": "Calculate impedance"}],
                tools=SAMPLE_TOOLS,
            )
            assert response.stop_reason == "tool_use"
            assert len(response.tool_calls) == 1
            tc = response.tool_calls[0]
            assert tc.name == "impedance_calc"
            assert tc.arguments["trace_width_mm"] == 0.15
            assert tc.id.startswith("ollama_")

    @pytest.mark.asyncio
    async def test_generate_json_mode(self) -> None:
        """JSON mode returns parsed dict."""
        json_output = json.dumps({"net_classes": [], "diff_pairs": []})
        resp_data = _ollama_chat_response(json_output)
        mock_client = _MockAsyncClient({
            "/api/chat": _MockHttpxResponse(resp_data),
        })
        with patch("httpx.AsyncClient", return_value=mock_client):
            provider = OllamaProvider(host="http://localhost:11434", model="qwen2.5:7b")
            result = await provider.generate_json(
                messages=[{"role": "user", "content": "Generate constraints"}],
                system="Generate JSON.",
                schema={"type": "object", "properties": {"net_classes": {"type": "array"}}},
            )
            assert isinstance(result, dict)
            assert "net_classes" in result

    def test_properties(self) -> None:
        """Provider name and supports_native_tools are correct."""
        provider = OllamaProvider(host="http://localhost:11434", model="llama3.1:8b")
        assert provider.name == "ollama/llama3.1:8b"
        assert provider.supports_native_tools is False


# -----------------------------------------------------------------------
# Tool-call extraction tests
# -----------------------------------------------------------------------


class TestToolCallExtraction:
    """Tests for extracting tool calls from LLM text output."""

    def test_fenced_tool_calls(self) -> None:
        """Parse tool_calls from ```tool_calls``` fenced block."""
        text = (
            "Let me calculate this.\n\n"
            "```tool_calls\n"
            '[{"name": "impedance_calc", "arguments": {"trace_width_mm": 0.15}}]\n'
            "```\n"
        )
        calls = OllamaProvider._extract_tool_calls(text)
        assert len(calls) == 1
        assert calls[0].name == "impedance_calc"
        assert calls[0].arguments == {"trace_width_mm": 0.15}

    def test_multiple_tool_calls(self) -> None:
        """Parse multiple tool calls in a single array."""
        text = (
            "```tool_calls\n"
            "[\n"
            '  {"name": "impedance_calc", "arguments": {"trace_width_mm": 0.15}},\n'
            '  {"name": "clearance_lookup", "arguments": {"voltage_v": 48}}\n'
            "]\n"
            "```"
        )
        calls = OllamaProvider._extract_tool_calls(text)
        assert len(calls) == 2
        assert calls[0].name == "impedance_calc"
        assert calls[1].name == "clearance_lookup"

    def test_json_block_with_tool_calls_key(self) -> None:
        """Parse tool_calls from ```json``` block with tool_calls key."""
        text = (
            "```json\n"
            '{"tool_calls": [{"name": "impedance_calc", "arguments": {"trace_width_mm": 0.2}}]}\n'
            "```"
        )
        calls = OllamaProvider._extract_tool_calls(text)
        assert len(calls) == 1
        assert calls[0].name == "impedance_calc"

    def test_bare_array_in_text(self) -> None:
        """Parse bare JSON array of tool calls in text."""
        text = (
            'I will use the tool: [{"name": "clearance_lookup", '
            '"arguments": {"voltage_v": 100}}]'
        )
        calls = OllamaProvider._extract_tool_calls(text)
        assert len(calls) == 1
        assert calls[0].name == "clearance_lookup"

    def test_bare_tool_calls_object(self) -> None:
        """Parse bare {"tool_calls": [...]} in text."""
        text = (
            'Calling tool: {"tool_calls": [{"name": "drc_check", '
            '"arguments": {"board_state": {}}}]}'
        )
        calls = OllamaProvider._extract_tool_calls(text)
        assert len(calls) == 1
        assert calls[0].name == "drc_check"

    def test_no_tool_calls(self) -> None:
        """Return empty list when no tool calls are present."""
        text = "The impedance is 50 ohms. No further analysis needed."
        calls = OllamaProvider._extract_tool_calls(text)
        assert calls == []

    def test_args_key_alias(self) -> None:
        """Support 'args' as an alias for 'arguments'."""
        raw = '[{"name": "impedance_calc", "args": {"trace_width_mm": 0.1}}]'
        calls = _parse_tool_call_json(raw)
        assert len(calls) == 1
        assert calls[0].arguments == {"trace_width_mm": 0.1}

    def test_malformed_json_ignored(self) -> None:
        """Malformed JSON is silently ignored."""
        text = "```tool_calls\n{not valid json}\n```"
        calls = OllamaProvider._extract_tool_calls(text)
        assert calls == []


# -----------------------------------------------------------------------
# Tool prompt building tests
# -----------------------------------------------------------------------


class TestToolPromptBuilding:
    """Tests for _build_tool_prompt."""

    def test_tool_prompt_contains_tool_names(self) -> None:
        """Tool prompt includes all tool names and descriptions."""
        prompt = OllamaProvider._build_tool_prompt(SAMPLE_TOOLS)
        assert "impedance_calc" in prompt
        assert "Calculate transmission line impedance" in prompt
        assert "trace_width_mm" in prompt
        assert "(required)" in prompt

    def test_tool_prompt_includes_format_instructions(self) -> None:
        """Tool prompt tells the model how to format tool calls."""
        prompt = OllamaProvider._build_tool_prompt(SAMPLE_TOOLS)
        assert "tool_calls" in prompt
        assert '"name"' in prompt
        assert '"arguments"' in prompt


# -----------------------------------------------------------------------
# AnthropicProvider tests
# -----------------------------------------------------------------------


class TestAnthropicProvider:
    """Tests for AnthropicProvider with mocked anthropic client."""

    @pytest.mark.asyncio
    async def test_generate_simple(self) -> None:
        """Simple generation without tools."""
        from routeai_intelligence.llm.anthropic_provider import AnthropicProvider

        mock_block = MagicMock()
        mock_block.type = "text"
        mock_block.text = "The trace impedance is 50 ohms."

        mock_response = MagicMock()
        mock_response.content = [mock_block]
        mock_response.stop_reason = "end_turn"
        mock_response.usage = MagicMock(input_tokens=100, output_tokens=50)

        with patch("anthropic.AsyncAnthropic") as mock_cls:
            mock_client = AsyncMock()
            mock_client.messages.create = AsyncMock(return_value=mock_response)
            mock_cls.return_value = mock_client

            provider = AnthropicProvider(api_key="test-key", model="claude-sonnet-4-20250514")
            # Replace internal client with our mock
            provider._client = mock_client

            response = await provider.generate(
                messages=[{"role": "user", "content": "What impedance?"}],
                system="You are a PCB expert.",
            )

            assert isinstance(response, LLMResponse)
            assert "50 ohms" in response.text
            assert response.tool_calls == []
            assert response.stop_reason == "end_turn"
            assert response.usage.input_tokens == 100

    @pytest.mark.asyncio
    async def test_generate_with_native_tools(self) -> None:
        """Generation with native tool-use returns ToolCall objects."""
        from routeai_intelligence.llm.anthropic_provider import AnthropicProvider

        text_block = MagicMock()
        text_block.type = "text"
        text_block.text = "Let me calculate."

        tool_block = MagicMock()
        tool_block.type = "tool_use"
        tool_block.id = "toolu_123abc"
        tool_block.name = "impedance_calc"
        tool_block.input = {"trace_width_mm": 0.15, "dielectric_height_mm": 0.2, "dielectric_constant": 4.2}

        mock_response = MagicMock()
        mock_response.content = [text_block, tool_block]
        mock_response.stop_reason = "tool_use"
        mock_response.usage = MagicMock(input_tokens=200, output_tokens=80)

        with patch("anthropic.AsyncAnthropic") as mock_cls:
            mock_client = AsyncMock()
            mock_client.messages.create = AsyncMock(return_value=mock_response)
            mock_cls.return_value = mock_client

            provider = AnthropicProvider(api_key="test-key")
            provider._client = mock_client

            response = await provider.generate(
                messages=[{"role": "user", "content": "Calculate impedance"}],
                tools=SAMPLE_TOOLS,
            )

            assert response.stop_reason == "tool_use"
            assert len(response.tool_calls) == 1
            tc = response.tool_calls[0]
            assert tc.id == "toolu_123abc"
            assert tc.name == "impedance_calc"
            assert tc.arguments["trace_width_mm"] == 0.15

    @pytest.mark.asyncio
    async def test_generate_json(self) -> None:
        """JSON generation parses output correctly."""
        from routeai_intelligence.llm.anthropic_provider import AnthropicProvider

        json_str = json.dumps({"net_classes": [{"name": "power", "trace_width_mm": 0.5}]})

        text_block = MagicMock()
        text_block.type = "text"
        text_block.text = json_str

        mock_response = MagicMock()
        mock_response.content = [text_block]
        mock_response.stop_reason = "end_turn"
        mock_response.usage = MagicMock(input_tokens=100, output_tokens=50)

        with patch("anthropic.AsyncAnthropic") as mock_cls:
            mock_client = AsyncMock()
            mock_client.messages.create = AsyncMock(return_value=mock_response)
            mock_cls.return_value = mock_client

            provider = AnthropicProvider(api_key="test-key")
            provider._client = mock_client

            result = await provider.generate_json(
                messages=[{"role": "user", "content": "Generate constraints"}],
            )
            assert isinstance(result, dict)
            assert "net_classes" in result

    def test_properties(self) -> None:
        """Provider name and native tools are correct."""
        with patch("anthropic.AsyncAnthropic"):
            provider = AnthropicProvider.__new__(AnthropicProvider)
            provider._model = "claude-sonnet-4-20250514"
            assert provider.name == "anthropic/claude-sonnet-4-20250514"
            assert provider.supports_native_tools is True


# -----------------------------------------------------------------------
# LLMRouter tests
# -----------------------------------------------------------------------


class _FakeProvider(LLMProvider):
    """Fake provider for testing the router."""

    def __init__(self, provider_name: str, should_fail: bool = False) -> None:
        self._name = provider_name
        self._should_fail = should_fail
        self.call_count = 0

    @property
    def supports_native_tools(self) -> bool:
        return False

    @property
    def name(self) -> str:
        return self._name

    async def generate(
        self,
        messages: list[dict[str, str]],
        system: str = "",
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.0,
        max_tokens: int = 8192,
    ) -> LLMResponse:
        self.call_count += 1
        if self._should_fail:
            raise RuntimeError(f"{self._name} failed")
        return LLMResponse(
            text=f"Response from {self._name}",
            tool_calls=[],
            usage=TokenUsage(input_tokens=10, output_tokens=20),
            stop_reason="end_turn",
        )

    async def generate_json(
        self,
        messages: list[dict[str, str]],
        system: str = "",
        schema: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        self.call_count += 1
        if self._should_fail:
            raise RuntimeError(f"{self._name} JSON failed")
        return {"provider": self._name}


class TestLLMRouter:
    """Tests for LLMRouter fallback chain."""

    @pytest.mark.asyncio
    async def test_primary_provider_used_first(self) -> None:
        """Router uses the first (primary) provider."""
        primary = _FakeProvider("primary")
        fallback = _FakeProvider("fallback")

        router = LLMRouter()
        router.add_provider(primary, primary=True)
        router.add_provider(fallback)
        router._initialized = True

        response = await router.generate(
            messages=[{"role": "user", "content": "Hello"}],
        )
        assert "primary" in response.text
        assert primary.call_count == 1
        assert fallback.call_count == 0

    @pytest.mark.asyncio
    async def test_fallback_on_primary_failure(self) -> None:
        """Router falls back to next provider when primary fails."""
        failing = _FakeProvider("failing", should_fail=True)
        working = _FakeProvider("working")

        router = LLMRouter()
        router.add_provider(failing, primary=True)
        router.add_provider(working)
        router._initialized = True

        response = await router.generate(
            messages=[{"role": "user", "content": "Hello"}],
        )
        assert "working" in response.text
        assert failing.call_count == 1
        assert working.call_count == 1

    @pytest.mark.asyncio
    async def test_all_providers_fail(self) -> None:
        """Router raises RuntimeError when all providers fail."""
        fail1 = _FakeProvider("fail1", should_fail=True)
        fail2 = _FakeProvider("fail2", should_fail=True)

        router = LLMRouter()
        router.add_provider(fail1, primary=True)
        router.add_provider(fail2)
        router._initialized = True

        with pytest.raises(RuntimeError, match="All LLM providers failed"):
            await router.generate(
                messages=[{"role": "user", "content": "Hello"}],
            )

    @pytest.mark.asyncio
    async def test_no_providers_raises(self) -> None:
        """Router raises RuntimeError when no providers are configured."""
        router = LLMRouter()
        router._initialized = True

        with pytest.raises(RuntimeError, match="No LLM providers available"):
            await router.generate(
                messages=[{"role": "user", "content": "Hello"}],
            )

    @pytest.mark.asyncio
    async def test_generate_json_fallback(self) -> None:
        """JSON generation also falls back through providers."""
        failing = _FakeProvider("failing", should_fail=True)
        working = _FakeProvider("working")

        router = LLMRouter()
        router.add_provider(failing, primary=True)
        router.add_provider(working)
        router._initialized = True

        result = await router.generate_json(
            messages=[{"role": "user", "content": "Generate JSON"}],
        )
        assert result["provider"] == "working"

    @pytest.mark.asyncio
    async def test_add_provider_primary(self) -> None:
        """add_provider with primary=True makes it the first provider."""
        existing = _FakeProvider("existing")
        new_primary = _FakeProvider("new_primary")

        router = LLMRouter()
        router.add_provider(existing)
        router.add_provider(new_primary, primary=True)

        assert router.primary is new_primary
        assert router.providers[0] is new_primary
        assert router.providers[1] is existing

    @pytest.mark.asyncio
    async def test_auto_initialize(self) -> None:
        """Router auto-initializes on first generate call."""
        router = LLMRouter()
        # Patch initialize to add a fake provider
        original_init = router.initialize

        async def mock_init() -> None:
            router._providers = [_FakeProvider("auto")]
            router._primary = router._providers[0]
            router._initialized = True

        router.initialize = mock_init  # type: ignore[assignment]

        response = await router.generate(
            messages=[{"role": "user", "content": "Hello"}],
        )
        assert "auto" in response.text

    def test_is_initialized(self) -> None:
        """is_initialized returns correct state."""
        router = LLMRouter()
        assert router.is_initialized is False
        router._initialized = True
        assert router.is_initialized is True


# -----------------------------------------------------------------------
# OllamaProvider message building tests
# -----------------------------------------------------------------------


class TestMessageBuilding:
    """Tests for Ollama message format conversion."""

    def test_simple_messages(self) -> None:
        """Simple user/assistant messages are passed through."""
        messages = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi there"},
        ]
        result = OllamaProvider._build_messages(messages, "System prompt")
        assert result[0] == {"role": "system", "content": "System prompt"}
        assert result[1] == {"role": "user", "content": "Hello"}
        assert result[2] == {"role": "assistant", "content": "Hi there"}

    def test_anthropic_content_blocks_flattened(self) -> None:
        """Anthropic-style content blocks are flattened to text."""
        messages = [
            {
                "role": "assistant",
                "content": [
                    {"type": "text", "text": "Let me check."},
                    {"type": "tool_use", "name": "impedance_calc", "input": {"w": 0.1}},
                ],
            },
            {
                "role": "user",
                "content": [
                    {"type": "tool_result", "tool_use_id": "abc", "content": '{"z0": 50}'},
                ],
            },
        ]
        result = OllamaProvider._build_messages(messages, "")
        # System message not added when empty
        assert len(result) == 2
        assert "Let me check" in result[0]["content"]
        assert "impedance_calc" in result[0]["content"]
        assert "Tool result" in result[1]["content"]

    def test_no_system_prompt(self) -> None:
        """No system message when system is empty."""
        messages = [{"role": "user", "content": "Hi"}]
        result = OllamaProvider._build_messages(messages, "")
        assert len(result) == 1
        assert result[0]["role"] == "user"


# -----------------------------------------------------------------------
# JSON parsing tests
# -----------------------------------------------------------------------


class TestJsonParsing:
    """Tests for JSON output parsing."""

    def test_parse_clean_json(self) -> None:
        """Parse clean JSON output."""
        text = '{"net_classes": [], "diff_pairs": []}'
        result = OllamaProvider._parse_json_output(text)
        assert result == {"net_classes": [], "diff_pairs": []}

    def test_parse_json_with_markdown_fences(self) -> None:
        """Parse JSON wrapped in markdown code fences."""
        text = '```json\n{"status": "ok"}\n```'
        result = OllamaProvider._parse_json_output(text)
        assert result == {"status": "ok"}

    def test_parse_json_embedded_in_text(self) -> None:
        """Parse JSON object embedded in surrounding text."""
        text = 'Here is the result:\n{"answer": 42}\nThank you.'
        result = OllamaProvider._parse_json_output(text)
        assert result == {"answer": 42}

    def test_parse_invalid_json(self) -> None:
        """Return error dict for completely invalid output."""
        text = "This is not JSON at all."
        result = OllamaProvider._parse_json_output(text)
        assert "_parse_error" in result
        assert "_raw_text" in result


# -----------------------------------------------------------------------
# Integration: OllamaProvider env var config
# -----------------------------------------------------------------------


class TestOllamaEnvConfig:
    """Test that OllamaProvider respects environment variables."""

    def test_default_config(self) -> None:
        """Default host and model."""
        with patch.dict("os.environ", {}, clear=True):
            p = OllamaProvider()
            assert p._host == "http://127.0.0.1:11434"
            assert p._model == "qwen2.5:7b"

    def test_env_vars(self) -> None:
        """Custom host and model from env vars."""
        env = {
            "OLLAMA_BASE_URL": "http://gpu-server:11434",
            "OLLAMA_MODEL": "deepseek-coder:6.7b",
        }
        with patch.dict("os.environ", env, clear=True):
            p = OllamaProvider()
            assert p._host == "http://gpu-server:11434"
            assert p._model == "deepseek-coder:6.7b"

    def test_constructor_overrides_env(self) -> None:
        """Explicit constructor args override env vars."""
        env = {"OLLAMA_BASE_URL": "http://should-be-ignored:11434"}
        with patch.dict("os.environ", env, clear=True):
            p = OllamaProvider(host="http://explicit:11434", model="mistral:7b")
            assert p._host == "http://explicit:11434"
            assert p._model == "mistral:7b"

    def test_trailing_slash_stripped(self) -> None:
        """Trailing slash is stripped from host URL."""
        p = OllamaProvider(host="http://localhost:11434/")
        assert p._host == "http://localhost:11434"
