"""LLM provider router with automatic detection and fallback.

Priority order: Ollama (local, fast, free) -> Claude (best quality) -> Gemini (fallback).

The router auto-detects available providers at startup and tries each in
priority order. If the primary provider fails, requests automatically fall
through to the next available provider.
"""

from __future__ import annotations

import logging
import os
from typing import Any

from routeai_intelligence.llm.provider import (
    LLMProvider,
    LLMResponse,
)

logger = logging.getLogger(__name__)


class LLMRouter:
    """Routes LLM requests to the best available provider.

    Priority: Ollama (local, fast, free) -> Claude (best quality) -> Gemini (fallback)

    Auto-detects available providers at startup.
    Falls back gracefully if the primary provider is unavailable or errors.
    """

    def __init__(self) -> None:
        self._providers: list[LLMProvider] = []
        self._primary: LLMProvider | None = None
        self._initialized: bool = False

    async def initialize(self) -> None:
        """Detect available providers and set priority order.

        Checks:
        1. Ollama server reachability and model availability.
        2. ``ANTHROPIC_API_KEY`` environment variable.
        3. ``GEMINI_API_KEY`` or ``GOOGLE_API_KEY`` environment variable.
        """
        from routeai_intelligence.llm.ollama_provider import OllamaProvider

        self._providers = []

        # 1. Check Ollama (primary -- local, free, no API key needed)
        ollama_host = (
            os.environ.get("OLLAMA_BASE_URL")
            or os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")
        )
        ollama_model = os.environ.get("OLLAMA_MODEL", "qwen2.5:7b")
        ollama = OllamaProvider(host=ollama_host, model=ollama_model)
        if await ollama.is_available():
            self._providers.append(ollama)
            logger.info("LLM provider available: %s", ollama.name)
        else:
            logger.info("Ollama not available at %s", ollama_host)

        # 2. Check Anthropic API key
        anthropic_key = os.environ.get("ANTHROPIC_API_KEY", "")
        if anthropic_key:
            from routeai_intelligence.llm.anthropic_provider import AnthropicProvider

            provider = AnthropicProvider(api_key=anthropic_key)
            self._providers.append(provider)
            logger.info("LLM provider available: %s", provider.name)

        # 3. Check Gemini API key
        gemini_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        if gemini_key:
            from routeai_intelligence.llm.gemini_provider import GeminiProvider

            provider = GeminiProvider(api_key=gemini_key)
            self._providers.append(provider)
            logger.info("LLM provider available: %s", provider.name)

        self._primary = self._providers[0] if self._providers else None
        self._initialized = True

        if self._primary:
            logger.info(
                "Primary LLM provider: %s (%d total available)",
                self._primary.name,
                len(self._providers),
            )
        else:
            logger.warning(
                "No LLM providers available. Start Ollama or set "
                "ANTHROPIC_API_KEY / GEMINI_API_KEY."
            )

    async def generate(
        self,
        messages: list[dict[str, str]],
        system: str = "",
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.0,
        max_tokens: int = 8192,
    ) -> LLMResponse:
        """Try primary provider, fall back to next on failure.

        Iterates through all available providers in priority order.  If a
        provider raises an exception, logs a warning and tries the next.

        Raises:
            RuntimeError: If all providers fail or none are configured.
        """
        if not self._initialized:
            await self.initialize()

        if not self._providers:
            raise RuntimeError(
                "No LLM providers available. Start Ollama or set "
                "ANTHROPIC_API_KEY / GEMINI_API_KEY."
            )

        last_error: Exception | None = None
        for provider in self._providers:
            try:
                return await provider.generate(
                    messages=messages,
                    system=system,
                    tools=tools,
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
            except Exception as exc:
                last_error = exc
                logger.warning(
                    "Provider %s failed: %s, trying next provider",
                    provider.name,
                    exc,
                )

        raise RuntimeError(
            f"All LLM providers failed. Last error: {last_error}"
        )

    async def generate_json(
        self,
        messages: list[dict[str, str]],
        system: str = "",
        schema: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Generate structured JSON with fallback.

        Tries each provider in order until one succeeds.

        Raises:
            RuntimeError: If all providers fail.
        """
        if not self._initialized:
            await self.initialize()

        if not self._providers:
            raise RuntimeError("No LLM providers available.")

        last_error: Exception | None = None
        for provider in self._providers:
            try:
                return await provider.generate_json(
                    messages=messages,
                    system=system,
                    schema=schema,
                )
            except Exception as exc:
                last_error = exc
                logger.warning(
                    "Provider %s JSON generation failed: %s, trying next",
                    provider.name,
                    exc,
                )

        raise RuntimeError(
            f"All LLM providers failed for JSON generation. Last error: {last_error}"
        )

    @property
    def primary(self) -> LLMProvider | None:
        """The current primary (highest priority) provider, or ``None``."""
        return self._primary

    @property
    def providers(self) -> list[LLMProvider]:
        """All available providers in priority order."""
        return list(self._providers)

    @property
    def is_initialized(self) -> bool:
        """Whether ``initialize()`` has been called."""
        return self._initialized

    def add_provider(self, provider: LLMProvider, primary: bool = False) -> None:
        """Manually add a provider (useful for testing or custom providers).

        Args:
            provider: The provider instance to add.
            primary: If ``True``, insert at position 0 (highest priority).
        """
        if primary:
            self._providers.insert(0, provider)
            self._primary = provider
        else:
            self._providers.append(provider)
            if self._primary is None:
                self._primary = provider
