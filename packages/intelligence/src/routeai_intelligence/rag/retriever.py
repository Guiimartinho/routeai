"""RAG retriever for PCB design knowledge base.

Performs similarity search over embedded documents stored in PostgreSQL with
pgvector. Supports filtering by domain (IPC standards, manufacturer datasheets,
reference designs) and returns ranked results with relevance scores.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)


@dataclass
class RetrievedDocument:
    """A document retrieved from the knowledge base."""

    content: str
    source: str
    relevance_score: float
    metadata: dict[str, Any] = field(default_factory=dict)


class KnowledgeRetriever:
    """Retrieves relevant documents from the PCB design knowledge base.

    Uses pgvector for approximate nearest-neighbor similarity search over
    pre-embedded document chunks. Supports domain filtering to narrow results
    to specific document types (IPC standards, datasheets, reference designs).

    Args:
        connection_string: PostgreSQL connection string with pgvector extension.
            Format: postgresql://user:pass@host:port/dbname
        table_name: Name of the embeddings table.
        embedding_dim: Dimensionality of stored embeddings.
    """

    def __init__(
        self,
        connection_string: str | None = None,
        table_name: str = "document_embeddings",
        embedding_dim: int = 1536,
    ) -> None:
        self._connection_string = connection_string
        self._table_name = table_name
        self._embedding_dim = embedding_dim
        self._pool: Any = None
        self._embedding_pipeline: Any = None

    async def _ensure_connection(self) -> None:
        """Establish database connection pool if not already connected."""
        if self._pool is not None:
            return

        if self._connection_string is None:
            import os
            self._connection_string = os.environ.get(
                "ROUTEAI_DB_URL",
                "postgresql://routeai:routeai@localhost:5432/routeai",
            )

        try:
            import asyncpg
            self._pool = await asyncpg.create_pool(
                self._connection_string,
                min_size=1,
                max_size=5,
            )
            logger.info("Connected to pgvector database")
        except Exception as exc:
            logger.warning(
                "Could not connect to database: %s. Retriever will return empty results.",
                exc,
            )
            self._pool = None

    async def _ensure_embedding_pipeline(self) -> None:
        """Initialize the embedding pipeline for query embedding."""
        if self._embedding_pipeline is not None:
            return

        from routeai_intelligence.rag.embeddings import EmbeddingPipeline
        self._embedding_pipeline = EmbeddingPipeline()

    async def search(
        self,
        query: str,
        top_k: int = 5,
        filters: dict[str, Any] | None = None,
    ) -> list[RetrievedDocument]:
        """Search the knowledge base for documents similar to the query.

        Embeds the query, then performs cosine similarity search in pgvector.
        Optionally filters by metadata fields (domain, component, section, etc.).

        Args:
            query: Natural language search query.
            top_k: Maximum number of results to return.
            filters: Optional metadata filters. Supported keys:
                - domain: 'ipc', 'manufacturer', 'reference_design', 'component'
                - component: Component part number or reference
                - section: Document section identifier
                - Any other metadata key stored during indexing

        Returns:
            List of RetrievedDocument objects sorted by relevance (highest first).
        """
        await self._ensure_connection()
        await self._ensure_embedding_pipeline()

        if self._pool is None:
            logger.warning("Database not available. Returning empty results.")
            return []

        # Embed the query
        query_embedding = await self._embedding_pipeline.embed_query(query)

        # Build SQL query with optional filters
        filter_clauses: list[str] = []
        filter_params: list[Any] = []
        param_idx = 2  # $1 is the embedding vector

        if filters:
            for key, value in filters.items():
                filter_clauses.append(f"metadata->>'{key}' = ${param_idx}")
                filter_params.append(str(value))
                param_idx += 1

        where_clause = ""
        if filter_clauses:
            where_clause = "WHERE " + " AND ".join(filter_clauses)

        sql = f"""
            SELECT
                content,
                source,
                metadata,
                1 - (embedding <=> $1::vector) AS similarity
            FROM {self._table_name}
            {where_clause}
            ORDER BY embedding <=> $1::vector
            LIMIT {top_k}
        """

        try:
            async with self._pool.acquire() as conn:
                # pgvector expects the embedding as a string representation
                embedding_str = "[" + ",".join(str(float(x)) for x in query_embedding) + "]"
                rows = await conn.fetch(sql, embedding_str, *filter_params)

                results = []
                for row in rows:
                    import json
                    metadata = row["metadata"]
                    if isinstance(metadata, str):
                        metadata = json.loads(metadata)

                    results.append(RetrievedDocument(
                        content=row["content"],
                        source=row["source"],
                        relevance_score=float(row["similarity"]),
                        metadata=metadata or {},
                    ))

                return results

        except Exception as exc:
            logger.error("Search query failed: %s", exc)
            return []

    async def search_by_embedding(
        self,
        embedding: np.ndarray,
        top_k: int = 5,
        filters: dict[str, Any] | None = None,
    ) -> list[RetrievedDocument]:
        """Search using a pre-computed embedding vector.

        Args:
            embedding: Query embedding vector.
            top_k: Maximum number of results.
            filters: Optional metadata filters.

        Returns:
            List of RetrievedDocument objects.
        """
        await self._ensure_connection()

        if self._pool is None:
            return []

        filter_clauses: list[str] = []
        filter_params: list[Any] = []
        param_idx = 2

        if filters:
            for key, value in filters.items():
                filter_clauses.append(f"metadata->>'{key}' = ${param_idx}")
                filter_params.append(str(value))
                param_idx += 1

        where_clause = ""
        if filter_clauses:
            where_clause = "WHERE " + " AND ".join(filter_clauses)

        sql = f"""
            SELECT
                content,
                source,
                metadata,
                1 - (embedding <=> $1::vector) AS similarity
            FROM {self._table_name}
            {where_clause}
            ORDER BY embedding <=> $1::vector
            LIMIT {top_k}
        """

        try:
            async with self._pool.acquire() as conn:
                embedding_str = "[" + ",".join(str(float(x)) for x in embedding) + "]"
                rows = await conn.fetch(sql, embedding_str, *filter_params)

                results = []
                for row in rows:
                    import json
                    metadata = row["metadata"]
                    if isinstance(metadata, str):
                        metadata = json.loads(metadata)

                    results.append(RetrievedDocument(
                        content=row["content"],
                        source=row["source"],
                        relevance_score=float(row["similarity"]),
                        metadata=metadata or {},
                    ))

                return results

        except Exception as exc:
            logger.error("Search by embedding failed: %s", exc)
            return []

    async def close(self) -> None:
        """Close the database connection pool."""
        if self._pool is not None:
            await self._pool.close()
            self._pool = None
