"""Embedding pipeline for document vectorization.

Generates dense vector embeddings for technical documents using configurable
embedding models. Supports chunking strategies optimized for PCB design
documentation (datasheets, IPC standards, reference designs).
"""

from __future__ import annotations

import hashlib
import logging
import re
from dataclasses import dataclass, field
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)

# Default embedding dimension (matches many common models)
DEFAULT_EMBEDDING_DIM = 1536

# Chunking parameters tuned for technical documents
DEFAULT_CHUNK_SIZE = 512  # tokens
DEFAULT_CHUNK_OVERLAP = 64  # tokens
MAX_CHUNK_SIZE = 2048


@dataclass
class DocumentChunk:
    """A chunk of a document ready for embedding."""

    text: str
    chunk_index: int
    source_document: str
    metadata: dict[str, Any] = field(default_factory=dict)
    content_hash: str = ""

    def __post_init__(self) -> None:
        if not self.content_hash:
            self.content_hash = hashlib.sha256(self.text.encode()).hexdigest()[:16]


@dataclass
class EmbeddedChunk:
    """A document chunk with its embedding vector."""

    chunk: DocumentChunk
    embedding: np.ndarray  # shape: (embedding_dim,)

    @property
    def text(self) -> str:
        return self.chunk.text

    @property
    def metadata(self) -> dict[str, Any]:
        return self.chunk.metadata


class EmbeddingPipeline:
    """Generates embeddings for technical document chunks.

    Supports two backends:
    - 'anthropic': Uses the Anthropic Voyager embedding model via API
    - 'local': Uses sentence-transformers for local inference (no API calls)

    The pipeline handles document chunking with overlap, preserving section
    boundaries and table structures common in PCB datasheets.

    Args:
        backend: Embedding backend ('anthropic' or 'local').
        model_name: Model identifier for the chosen backend.
        chunk_size: Target chunk size in approximate tokens.
        chunk_overlap: Number of overlapping tokens between consecutive chunks.
        embedding_dim: Dimensionality of output embeddings.
    """

    def __init__(
        self,
        backend: str = "local",
        model_name: str = "all-MiniLM-L6-v2",
        chunk_size: int = DEFAULT_CHUNK_SIZE,
        chunk_overlap: int = DEFAULT_CHUNK_OVERLAP,
        embedding_dim: int = DEFAULT_EMBEDDING_DIM,
    ) -> None:
        self._backend = backend
        self._model_name = model_name
        self._chunk_size = min(chunk_size, MAX_CHUNK_SIZE)
        self._chunk_overlap = chunk_overlap
        self._embedding_dim = embedding_dim
        self._model: Any = None

    async def _ensure_model(self) -> None:
        """Lazily load the embedding model."""
        if self._model is not None:
            return

        if self._backend == "local":
            try:
                from sentence_transformers import SentenceTransformer
                self._model = SentenceTransformer(self._model_name)
                self._embedding_dim = self._model.get_sentence_embedding_dimension()
                logger.info(
                    "Loaded local embedding model '%s' (dim=%d)",
                    self._model_name,
                    self._embedding_dim,
                )
            except ImportError:
                logger.warning(
                    "sentence-transformers not installed. Falling back to random embeddings. "
                    "Install with: pip install sentence-transformers"
                )
                self._model = "fallback"
        elif self._backend == "anthropic":
            # Anthropic embeddings are called via the API; no local model to load
            self._model = "anthropic_api"
        else:
            logger.warning("Unknown backend '%s', using fallback", self._backend)
            self._model = "fallback"

    async def embed_document(
        self,
        text: str,
        metadata: dict[str, Any] | None = None,
    ) -> list[EmbeddedChunk]:
        """Chunk and embed a single document.

        Args:
            text: Full document text.
            metadata: Metadata to attach to all chunks (source, doc_type, etc.).

        Returns:
            List of EmbeddedChunk objects with embeddings.
        """
        await self._ensure_model()

        chunks = self._chunk_text(text, metadata or {})
        if not chunks:
            return []

        texts = [c.text for c in chunks]
        embeddings = await self._embed_texts(texts)

        return [
            EmbeddedChunk(chunk=chunk, embedding=emb)
            for chunk, emb in zip(chunks, embeddings)
        ]

    async def embed_batch(
        self,
        documents: list[dict[str, Any]],
    ) -> list[EmbeddedChunk]:
        """Chunk and embed a batch of documents.

        Args:
            documents: List of dicts with 'text' and optional 'metadata' keys.

        Returns:
            Flat list of EmbeddedChunk objects from all documents.
        """
        await self._ensure_model()

        all_chunks: list[DocumentChunk] = []
        for doc in documents:
            text = doc.get("text", "")
            metadata = doc.get("metadata", {})
            chunks = self._chunk_text(text, metadata)
            all_chunks.extend(chunks)

        if not all_chunks:
            return []

        texts = [c.text for c in all_chunks]
        embeddings = await self._embed_texts(texts)

        return [
            EmbeddedChunk(chunk=chunk, embedding=emb)
            for chunk, emb in zip(all_chunks, embeddings)
        ]

    async def embed_query(self, query: str) -> np.ndarray:
        """Embed a search query for similarity matching.

        Args:
            query: The search query text.

        Returns:
            Embedding vector as numpy array.
        """
        await self._ensure_model()
        embeddings = await self._embed_texts([query])
        return embeddings[0]

    # ------------------------------------------------------------------
    # Chunking
    # ------------------------------------------------------------------

    def _chunk_text(
        self,
        text: str,
        metadata: dict[str, Any],
    ) -> list[DocumentChunk]:
        """Split text into overlapping chunks, respecting section boundaries.

        Chunking strategy for technical documents:
        1. Split on section headers (lines starting with # or all-caps titles)
        2. Within sections, split on paragraph boundaries
        3. If a paragraph exceeds chunk_size, split on sentence boundaries
        4. Apply overlap between consecutive chunks
        """
        if not text.strip():
            return []

        source = metadata.get("source", "unknown")

        # Split into sections first
        sections = self._split_sections(text)

        chunks: list[DocumentChunk] = []
        chunk_idx = 0

        for section in sections:
            section_text = section.strip()
            if not section_text:
                continue

            # Approximate token count (rough: 1 token ~ 4 chars for English)
            approx_tokens = len(section_text) // 4

            if approx_tokens <= self._chunk_size:
                # Section fits in one chunk
                chunks.append(DocumentChunk(
                    text=section_text,
                    chunk_index=chunk_idx,
                    source_document=source,
                    metadata={**metadata, "chunk_index": chunk_idx},
                ))
                chunk_idx += 1
            else:
                # Split section into smaller chunks
                sub_chunks = self._split_into_chunks(section_text)
                for sub_text in sub_chunks:
                    chunks.append(DocumentChunk(
                        text=sub_text,
                        chunk_index=chunk_idx,
                        source_document=source,
                        metadata={**metadata, "chunk_index": chunk_idx},
                    ))
                    chunk_idx += 1

        return chunks

    def _split_sections(self, text: str) -> list[str]:
        """Split text on section headers."""
        # Match markdown headers or all-caps lines (common in datasheets)
        section_pattern = re.compile(
            r"(?:^|\n)(?=#{1,4}\s|\n[A-Z][A-Z\s]{5,}\n)",
            re.MULTILINE,
        )
        sections = section_pattern.split(text)
        return [s for s in sections if s.strip()]

    def _split_into_chunks(self, text: str) -> list[str]:
        """Split text into chunks of approximately chunk_size tokens with overlap."""
        # Split on sentence boundaries
        sentences = re.split(r"(?<=[.!?])\s+", text)

        chunks: list[str] = []
        current_chunk: list[str] = []
        current_length = 0
        target_chars = self._chunk_size * 4  # approximate tokens to chars
        overlap_chars = self._chunk_overlap * 4

        for sentence in sentences:
            sentence_len = len(sentence)

            if current_length + sentence_len > target_chars and current_chunk:
                # Emit current chunk
                chunks.append(" ".join(current_chunk))

                # Keep overlap: take sentences from the end of current chunk
                overlap_text = " ".join(current_chunk)
                if len(overlap_text) > overlap_chars:
                    # Find a sentence boundary within the overlap window
                    overlap_start = len(overlap_text) - overlap_chars
                    # Find the next sentence start after overlap_start
                    overlap_sentences = []
                    running = 0
                    for s in reversed(current_chunk):
                        running += len(s) + 1
                        overlap_sentences.insert(0, s)
                        if running >= overlap_chars:
                            break
                    current_chunk = overlap_sentences
                    current_length = sum(len(s) for s in current_chunk)
                else:
                    current_chunk = list(current_chunk)
                    current_length = sum(len(s) for s in current_chunk)

            current_chunk.append(sentence)
            current_length += sentence_len

        if current_chunk:
            chunks.append(" ".join(current_chunk))

        return chunks

    # ------------------------------------------------------------------
    # Embedding generation
    # ------------------------------------------------------------------

    async def _embed_texts(self, texts: list[str]) -> list[np.ndarray]:
        """Generate embeddings for a list of texts using the configured backend."""
        if self._model == "fallback" or self._model is None:
            # Deterministic fallback: hash-based pseudo-random embeddings
            return [self._fallback_embed(t) for t in texts]

        if self._backend == "local":
            return self._local_embed(texts)

        if self._backend == "anthropic":
            return await self._anthropic_embed(texts)

        return [self._fallback_embed(t) for t in texts]

    def _local_embed(self, texts: list[str]) -> list[np.ndarray]:
        """Generate embeddings using sentence-transformers."""
        embeddings = self._model.encode(texts, normalize_embeddings=True)
        return [np.array(emb, dtype=np.float32) for emb in embeddings]

    async def _anthropic_embed(self, texts: list[str]) -> list[np.ndarray]:
        """Generate embeddings using Anthropic's embedding API.

        Note: This is a placeholder. Anthropic's embedding API details may
        change. In production, replace with the actual API call.
        """
        # Placeholder: in production, use the actual Anthropic embeddings endpoint
        logger.warning(
            "Anthropic embedding API not yet available. Using fallback embeddings."
        )
        return [self._fallback_embed(t) for t in texts]

    def _fallback_embed(self, text: str) -> np.ndarray:
        """Generate a deterministic pseudo-embedding from text hash.

        Used when no embedding model is available. Produces consistent
        embeddings for the same input text, but with no semantic meaning.
        """
        hash_bytes = hashlib.sha256(text.encode()).digest()
        # Expand hash to fill embedding dimension
        rng = np.random.RandomState(
            int.from_bytes(hash_bytes[:4], "big")
        )
        embedding = rng.randn(self._embedding_dim).astype(np.float32)
        # L2 normalize
        norm = np.linalg.norm(embedding)
        if norm > 0:
            embedding = embedding / norm
        return embedding
