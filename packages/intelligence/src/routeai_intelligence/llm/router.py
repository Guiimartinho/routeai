"""LLM provider router — local Ollama only.

RouteAI runs 100% locally via Ollama. Cloud providers (Anthropic, Gemini)
are NOT auto-detected. They remain importable for developers who want to
add them manually via ``add_provider()``.
"""

from __future__ import annotations

import logging
import os
from typing import Any

from routeai_intelligence.llm.gpu_detect import get_vram_gb
from routeai_intelligence.llm.model_manager import ModelManager
from routeai_intelligence.llm.provider import (
    LLMProvider,
    LLMResponse,
)

logger = logging.getLogger(__name__)


class LLMRouter:
    """Routes LLM requests to the best available local provider.

    Only Ollama is auto-detected. Cloud providers (Anthropic, Gemini) can be
    added manually via ``add_provider()`` for testing, but are never
    auto-detected.
    """

    def __init__(self) -> None:
        self._providers: list[LLMProvider] = []
        self._primary: LLMProvider | None = None
        self._initialized: bool = False
        self._model_manager: ModelManager | None = None

    async def initialize(self) -> None:
        """Detect available providers and set priority order.

        Only Ollama (local) is auto-detected. RouteAI is 100% local --
        no cloud APIs are used by default. Developers can still add
        cloud providers manually via ``add_provider()`` if needed.
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
            # Create VRAM-aware model manager for local Ollama inference
            self._model_manager = ModelManager(get_vram_gb())
        else:
            logger.info("Ollama not available at %s", ollama_host)

        # ── Cloud providers disabled (RouteAI is 100% local) ─────────
        # Anthropic and Gemini are NOT auto-detected. The provider files
        # still exist so developers can manually instantiate them via
        # add_provider() for testing or comparison, but RouteAI ships
        # as a fully local, GPU-first platform with no cloud dependency.
        #
        # # 2. Check Anthropic API key
        # anthropic_key = os.environ.get("ANTHROPIC_API_KEY", "")
        # if anthropic_key:
        #     from routeai_intelligence.llm.anthropic_provider import AnthropicProvider
        #
        #     provider = AnthropicProvider(api_key=anthropic_key)
        #     self._providers.append(provider)
        #     logger.info("LLM provider available: %s", provider.name)
        #
        # # 3. Check Gemini API key
        # gemini_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        # if gemini_key:
        #     from routeai_intelligence.llm.gemini_provider import GeminiProvider
        #
        #     provider = GeminiProvider(api_key=gemini_key)
        #     self._providers.append(provider)
        #     logger.info("LLM provider available: %s", provider.name)

        self._primary = self._providers[0] if self._providers else None
        self._initialized = True

        if self._primary:
            logger.info(
                "Primary LLM provider: %s (%d total available)",
                self._primary.name,
                len(self._providers),
            )
        else:
            logger.error(
                "Ollama not available. RouteAI requires local Ollama "
                "for LLM inference. Install: curl -fsSL "
                "https://ollama.ai/install.sh | sh, then run: "
                "./scripts/setup_ollama.sh"
            )

    async def generate(
        self,
        messages: list[dict[str, str]],
        system: str = "",
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.0,
        max_tokens: int = 8192,
        task_type: str = "chat",
    ) -> LLMResponse:
        """Try primary provider, fall back to next on failure.

        Iterates through all available providers in priority order.  If a
        provider raises an exception, logs a warning and tries the next.

        Args:
            messages: Conversation messages.
            system: System prompt.
            tools: Tool schemas for tool-use.
            temperature: Sampling temperature.
            max_tokens: Maximum tokens in response.
            task_type: Task type for VRAM-aware model selection (e.g.
                ``"design_review"``, ``"constraint_generation"``, ``"chat"``).

        Raises:
            RuntimeError: If all providers fail or none are configured.
        """
        if not self._initialized:
            await self.initialize()

        if not self._providers:
            raise RuntimeError(
                "No LLM providers available. Start Ollama and run "
                "./scripts/setup_ollama.sh to set up local inference."
            )

        # Select the optimal model for this task type via the ModelManager
        model_override: str | None = None
        if self._model_manager is not None:
            model_override = self._model_manager.select_model(task_type)
            logger.debug(
                "ModelManager selected model '%s' for task_type='%s'",
                model_override,
                task_type,
            )

        last_error: Exception | None = None
        for provider in self._providers:
            try:
                kwargs: dict[str, Any] = {
                    "messages": messages,
                    "system": system,
                    "tools": tools,
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                }
                # Pass model_override to OllamaProvider
                if model_override is not None:
                    from routeai_intelligence.llm.ollama_provider import OllamaProvider

                    if isinstance(provider, OllamaProvider):
                        kwargs["model_override"] = model_override

                return await provider.generate(**kwargs)
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
        task_type: str = "chat",
    ) -> dict[str, Any]:
        """Generate structured JSON with fallback.

        Tries each provider in order until one succeeds.

        Args:
            messages: Conversation messages.
            system: System prompt.
            schema: JSON schema for the expected output structure.
            task_type: Task type for VRAM-aware model selection.

        Raises:
            RuntimeError: If all providers fail.
        """
        if not self._initialized:
            await self.initialize()

        if not self._providers:
            raise RuntimeError("No LLM providers available.")

        # Select the optimal model for this task type via the ModelManager
        model_override: str | None = None
        if self._model_manager is not None:
            model_override = self._model_manager.select_model(task_type)
            logger.debug(
                "ModelManager selected model '%s' for task_type='%s' (JSON)",
                model_override,
                task_type,
            )

        last_error: Exception | None = None
        for provider in self._providers:
            try:
                kwargs: dict[str, Any] = {
                    "messages": messages,
                    "system": system,
                    "schema": schema,
                }
                # Pass model_override to OllamaProvider
                if model_override is not None:
                    from routeai_intelligence.llm.ollama_provider import OllamaProvider

                    if isinstance(provider, OllamaProvider):
                        kwargs["model_override"] = model_override

                return await provider.generate_json(**kwargs)
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

    @property
    def model_manager(self) -> ModelManager | None:
        """The VRAM-aware model manager, or ``None`` if Ollama is not available."""
        return self._model_manager

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
