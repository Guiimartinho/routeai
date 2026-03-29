"""Tests for the RAG pipeline.

Tests document chunking, embedding generation (mocked), retriever search
(mocked pgvector), and metadata filtering.
"""

from __future__ import annotations

import hashlib
from unittest.mock import AsyncMock, MagicMock, patch

import numpy as np
import pytest

from routeai_intelligence.rag.embeddings import (
    DEFAULT_CHUNK_OVERLAP,
    DEFAULT_CHUNK_SIZE,
    DEFAULT_EMBEDDING_DIM,
    DocumentChunk,
    EmbeddedChunk,
    EmbeddingPipeline,
)
from routeai_intelligence.rag.indexer import DocumentIndexer
from routeai_intelligence.rag.retriever import KnowledgeRetriever, RetrievedDocument


# ---------------------------------------------------------------------------
# Document Chunking Tests
# ---------------------------------------------------------------------------


class TestDocumentChunking:
    """Test text chunking in the EmbeddingPipeline."""

    def test_short_text_single_chunk(self):
        """Text shorter than chunk_size should produce a single chunk."""
        pipeline = EmbeddingPipeline(chunk_size=512)
        chunks = pipeline._chunk_text(
            "This is a short document about PCB design.",
            {"source": "test.txt"},
        )
        assert len(chunks) == 1
        assert chunks[0].chunk_index == 0
        assert chunks[0].source_document == "test.txt"

    def test_long_text_multiple_chunks(self):
        """Text exceeding chunk_size should produce multiple chunks."""
        pipeline = EmbeddingPipeline(chunk_size=50)  # Very small for testing
        long_text = "This is sentence one. " * 100
        chunks = pipeline._chunk_text(long_text, {"source": "long.txt"})
        assert len(chunks) > 1

    def test_empty_text_no_chunks(self):
        """Empty text should produce no chunks."""
        pipeline = EmbeddingPipeline()
        chunks = pipeline._chunk_text("", {"source": "empty.txt"})
        assert len(chunks) == 0

    def test_whitespace_only_no_chunks(self):
        pipeline = EmbeddingPipeline()
        chunks = pipeline._chunk_text("   \n\n   ", {"source": "spaces.txt"})
        assert len(chunks) == 0

    def test_section_split_on_headers(self):
        """Text with markdown headers should be split on section boundaries."""
        pipeline = EmbeddingPipeline(chunk_size=1000)
        text = "# Section 1\nContent of section one.\n\n# Section 2\nContent of section two."
        chunks = pipeline._chunk_text(text, {"source": "sections.txt"})
        assert len(chunks) >= 2

    def test_chunk_metadata_propagated(self):
        """Metadata should be propagated to all chunks."""
        pipeline = EmbeddingPipeline()
        metadata = {"source": "datasheet.pdf", "domain": "manufacturer", "component": "STM32"}
        chunks = pipeline._chunk_text("Some content here.", metadata)
        assert len(chunks) == 1
        assert chunks[0].metadata["component"] == "STM32"
        assert chunks[0].metadata["domain"] == "manufacturer"

    def test_chunk_has_content_hash(self):
        """Each chunk should have a content hash."""
        pipeline = EmbeddingPipeline()
        chunks = pipeline._chunk_text("Test content.", {"source": "test.txt"})
        assert len(chunks[0].content_hash) == 16  # SHA-256 truncated to 16

    def test_document_chunk_hash_deterministic(self):
        """Same text should produce same content hash."""
        c1 = DocumentChunk(text="hello", chunk_index=0, source_document="a")
        c2 = DocumentChunk(text="hello", chunk_index=1, source_document="b")
        assert c1.content_hash == c2.content_hash

    def test_document_chunk_different_text_different_hash(self):
        c1 = DocumentChunk(text="hello", chunk_index=0, source_document="a")
        c2 = DocumentChunk(text="world", chunk_index=0, source_document="a")
        assert c1.content_hash != c2.content_hash


# ---------------------------------------------------------------------------
# Embedding Generation Tests (mocked)
# ---------------------------------------------------------------------------


class TestEmbeddingGeneration:
    """Test embedding generation with fallback backend."""

    @pytest.mark.asyncio
    async def test_fallback_embed_returns_correct_dim(self):
        """Fallback embedding should produce vectors of correct dimension."""
        pipeline = EmbeddingPipeline(backend="fallback_test", embedding_dim=384)
        await pipeline._ensure_model()
        embedding = pipeline._fallback_embed("test text")
        assert embedding.shape == (384,)
        assert embedding.dtype == np.float32

    @pytest.mark.asyncio
    async def test_fallback_embed_normalized(self):
        """Fallback embedding should be L2-normalized."""
        pipeline = EmbeddingPipeline(backend="fallback_test", embedding_dim=256)
        await pipeline._ensure_model()
        embedding = pipeline._fallback_embed("test text")
        norm = np.linalg.norm(embedding)
        assert abs(norm - 1.0) < 1e-5

    @pytest.mark.asyncio
    async def test_fallback_embed_deterministic(self):
        """Same text should produce same fallback embedding."""
        pipeline = EmbeddingPipeline(backend="fallback_test")
        await pipeline._ensure_model()
        e1 = pipeline._fallback_embed("hello world")
        e2 = pipeline._fallback_embed("hello world")
        np.testing.assert_array_equal(e1, e2)

    @pytest.mark.asyncio
    async def test_fallback_embed_different_text_different_vector(self):
        """Different text should produce different embeddings."""
        pipeline = EmbeddingPipeline(backend="fallback_test")
        await pipeline._ensure_model()
        e1 = pipeline._fallback_embed("hello")
        e2 = pipeline._fallback_embed("world")
        assert not np.array_equal(e1, e2)

    @pytest.mark.asyncio
    async def test_embed_query(self):
        """embed_query should return a numpy array."""
        pipeline = EmbeddingPipeline(backend="local", embedding_dim=1536)
        # Force fallback since sentence-transformers may not be installed
        pipeline._model = "fallback"
        result = await pipeline.embed_query("USB 2.0 differential impedance")
        assert isinstance(result, np.ndarray)
        assert result.shape[0] > 0

    @pytest.mark.asyncio
    async def test_embed_document_produces_embedded_chunks(self):
        """embed_document should return EmbeddedChunk objects."""
        pipeline = EmbeddingPipeline(backend="local", embedding_dim=128)
        pipeline._model = "fallback"
        pipeline._embedding_dim = 128

        results = await pipeline.embed_document(
            "This is a test document about PCB impedance.",
            metadata={"source": "test.txt"},
        )
        assert len(results) >= 1
        assert isinstance(results[0], EmbeddedChunk)
        assert results[0].embedding.shape == (128,)
        assert results[0].text == results[0].chunk.text

    @pytest.mark.asyncio
    async def test_embed_batch(self):
        """embed_batch should process multiple documents."""
        pipeline = EmbeddingPipeline(backend="local", embedding_dim=64)
        pipeline._model = "fallback"
        pipeline._embedding_dim = 64

        docs = [
            {"text": "Document one about resistors.", "metadata": {"source": "doc1"}},
            {"text": "Document two about capacitors.", "metadata": {"source": "doc2"}},
        ]
        results = await pipeline.embed_batch(docs)
        assert len(results) >= 2

    @pytest.mark.asyncio
    async def test_embed_empty_document(self):
        """Empty document should produce no chunks."""
        pipeline = EmbeddingPipeline(backend="local")
        pipeline._model = "fallback"
        results = await pipeline.embed_document("", metadata={})
        assert len(results) == 0

    @pytest.mark.asyncio
    async def test_chunk_size_clamped_to_max(self):
        """Chunk size exceeding MAX_CHUNK_SIZE should be clamped."""
        pipeline = EmbeddingPipeline(chunk_size=99999)
        from routeai_intelligence.rag.embeddings import MAX_CHUNK_SIZE
        assert pipeline._chunk_size == MAX_CHUNK_SIZE


# ---------------------------------------------------------------------------
# Retriever Search Tests (mocked pgvector)
# ---------------------------------------------------------------------------


class TestRetrieverSearch:
    """Test KnowledgeRetriever search with mocked database."""

    @pytest.mark.asyncio
    async def test_search_returns_documents(self):
        """search should return RetrievedDocument objects from pgvector."""
        retriever = KnowledgeRetriever(connection_string="postgresql://test:test@localhost/test")

        mock_row = {
            "content": "USB 2.0 requires 90 ohm differential impedance",
            "source": "USB specification",
            "metadata": '{"section": "signal_integrity"}',
            "similarity": 0.95,
        }

        mock_conn = AsyncMock()
        mock_conn.fetch = AsyncMock(return_value=[mock_row])

        mock_pool = AsyncMock()
        mock_pool.acquire.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_pool.acquire.return_value.__aexit__ = AsyncMock(return_value=None)

        retriever._pool = mock_pool

        # Mock embedding pipeline
        mock_embed = AsyncMock(return_value=np.zeros(1536, dtype=np.float32))
        retriever._embedding_pipeline = MagicMock()
        retriever._embedding_pipeline.embed_query = mock_embed

        results = await retriever.search("USB impedance", top_k=5)

        assert len(results) == 1
        assert isinstance(results[0], RetrievedDocument)
        assert results[0].relevance_score == 0.95
        assert results[0].source == "USB specification"

    @pytest.mark.asyncio
    async def test_search_no_pool_returns_empty(self):
        """Search with no database connection should return empty list."""
        retriever = KnowledgeRetriever()
        retriever._pool = None

        # Mock _ensure_connection to keep pool as None
        retriever._ensure_connection = AsyncMock()
        retriever._ensure_embedding_pipeline = AsyncMock()

        results = await retriever.search("anything")
        assert results == []

    @pytest.mark.asyncio
    async def test_search_exception_returns_empty(self):
        """Database exception during search should return empty list."""
        retriever = KnowledgeRetriever()

        mock_conn = AsyncMock()
        mock_conn.fetch = AsyncMock(side_effect=Exception("connection lost"))

        mock_pool = AsyncMock()
        mock_pool.acquire.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_pool.acquire.return_value.__aexit__ = AsyncMock(return_value=None)

        retriever._pool = mock_pool
        retriever._embedding_pipeline = MagicMock()
        retriever._embedding_pipeline.embed_query = AsyncMock(
            return_value=np.zeros(1536, dtype=np.float32)
        )

        results = await retriever.search("test query")
        assert results == []


# ---------------------------------------------------------------------------
# Metadata Filtering Tests
# ---------------------------------------------------------------------------


class TestMetadataFiltering:
    """Test that metadata filters are passed correctly to SQL queries."""

    @pytest.mark.asyncio
    async def test_filters_included_in_sql(self):
        """Filters should appear in the SQL WHERE clause."""
        retriever = KnowledgeRetriever()

        mock_conn = AsyncMock()
        mock_conn.fetch = AsyncMock(return_value=[])

        mock_pool = AsyncMock()
        mock_pool.acquire.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_pool.acquire.return_value.__aexit__ = AsyncMock(return_value=None)

        retriever._pool = mock_pool
        retriever._embedding_pipeline = MagicMock()
        retriever._embedding_pipeline.embed_query = AsyncMock(
            return_value=np.zeros(1536, dtype=np.float32)
        )

        await retriever.search(
            "decoupling capacitor",
            filters={"domain": "manufacturer", "component": "STM32F405"},
        )

        # Verify the SQL query was called with filter parameters
        call_args = mock_conn.fetch.call_args
        sql = call_args[0][0]
        assert "WHERE" in sql
        assert "domain" in sql
        assert "component" in sql
        # Filter values should be passed as extra parameters
        assert "manufacturer" in call_args[0]
        assert "STM32F405" in call_args[0]

    @pytest.mark.asyncio
    async def test_no_filters_no_where_clause(self):
        """No filters should produce no WHERE clause."""
        retriever = KnowledgeRetriever()

        mock_conn = AsyncMock()
        mock_conn.fetch = AsyncMock(return_value=[])

        mock_pool = AsyncMock()
        mock_pool.acquire.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_pool.acquire.return_value.__aexit__ = AsyncMock(return_value=None)

        retriever._pool = mock_pool
        retriever._embedding_pipeline = MagicMock()
        retriever._embedding_pipeline.embed_query = AsyncMock(
            return_value=np.zeros(1536, dtype=np.float32)
        )

        await retriever.search("test", filters=None)

        call_args = mock_conn.fetch.call_args
        sql = call_args[0][0]
        assert "WHERE" not in sql


# ---------------------------------------------------------------------------
# Indexer Tests
# ---------------------------------------------------------------------------


class TestDocumentIndexer:
    """Test document indexer parsing."""

    def test_parse_ipc_sections_with_clauses(self):
        """IPC document with numbered clauses should be split into sections."""
        text = (
            "1.1 Scope\nThis standard covers...\n\n"
            "2.1 General Requirements\nAll boards must...\n\n"
            "2.2 Clearance Requirements\nMinimum clearance is...\n"
        )
        sections = DocumentIndexer._parse_ipc_sections(text)
        assert len(sections) >= 3
        clause_sections = [s for s in sections if s["type"] == "clause"]
        assert len(clause_sections) >= 3
        assert clause_sections[0]["id"] == "1.1"

    def test_parse_ipc_sections_no_clauses(self):
        """IPC document without structured clauses should be returned as one section."""
        text = "This is just a plain document without numbered sections."
        sections = DocumentIndexer._parse_ipc_sections(text)
        assert len(sections) == 1
        assert sections[0]["type"] == "full_document"

    def test_parse_datasheet_sections(self):
        """Datasheet with recognized headers should be split."""
        text = (
            "Features\nLow power consumption\n\n"
            "Electrical Characteristics\nVCC = 3.3V typical\n\n"
            "Layout Guidelines\nPlace caps close to pins\n"
        )
        sections = DocumentIndexer._parse_datasheet_sections(text)
        assert len(sections) >= 3
        section_names = {s["section_name"] for s in sections}
        assert "features" in section_names
        assert "electrical_characteristics" in section_names
        assert "layout_guidelines" in section_names

    def test_detect_ipc_standard_id_from_filename(self):
        assert DocumentIndexer._detect_ipc_standard_id("", "IPC-2221B.pdf") == "IPC-2221B"
        assert DocumentIndexer._detect_ipc_standard_id("", "ipc_7351c_spec.txt") == "IPC-7351C"

    def test_detect_ipc_standard_id_from_text(self):
        text = "This document is IPC-2141A, the standard for..."
        result = DocumentIndexer._detect_ipc_standard_id(text, "standard.pdf")
        assert result == "IPC-2141A"

    def test_detect_ipc_standard_id_fallback(self):
        result = DocumentIndexer._detect_ipc_standard_id("no standard here", "random.pdf")
        assert result == "IPC-UNKNOWN"

    def test_read_document_text_file(self, tmp_path):
        """_read_document should read text files."""
        f = tmp_path / "test.txt"
        f.write_text("Hello PCB World")
        content = DocumentIndexer._read_document(f)
        assert content == "Hello PCB World"

    def test_read_document_json_file(self, tmp_path):
        """_read_document should parse JSON files."""
        import json

        f = tmp_path / "test.json"
        f.write_text(json.dumps({"key": "value"}))
        content = DocumentIndexer._read_document(f)
        assert "key" in content
        assert "value" in content

    @pytest.mark.asyncio
    async def test_close_pool(self):
        """close() should close the connection pool."""
        retriever = KnowledgeRetriever()
        mock_pool = AsyncMock()
        retriever._pool = mock_pool
        await retriever.close()
        mock_pool.close.assert_called_once()
        assert retriever._pool is None
