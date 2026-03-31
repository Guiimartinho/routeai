"""Local SQLite-based vector store for desktop use (no PostgreSQL required).

Stores document chunks with their embeddings in a SQLite database. Retrieval
uses brute-force cosine similarity, which is efficient for up to ~100K chunks.
This allows RouteAI to run fully offline on a developer workstation.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)


@dataclass
class VectorRecord:
    """A single record in the vector store."""

    id: str
    text: str
    embedding: np.ndarray
    metadata: dict[str, Any] = field(default_factory=dict)
    similarity: float = 0.0


class LocalVectorStore:
    """SQLite-backed vector store with brute-force cosine similarity search.

    Schema:
        - id: TEXT PRIMARY KEY
        - text: TEXT NOT NULL
        - embedding: BLOB NOT NULL (numpy array serialized as bytes)
        - metadata: TEXT (JSON-encoded dict)

    All embeddings are L2-normalized on insert so cosine similarity reduces
    to a dot product, making search faster.

    Args:
        db_path: Path to the SQLite database file. Created if it does not exist.
        table_name: Name of the table storing vectors.
    """

    def __init__(
        self,
        db_path: str | Path = "datasheet_index.db",
        table_name: str = "vectors",
    ) -> None:
        self._db_path = Path(db_path)
        self._table_name = table_name
        self._conn: sqlite3.Connection | None = None

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def connect(self) -> None:
        """Open (or create) the SQLite database and ensure the table exists."""
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(self._db_path))
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA synchronous=NORMAL")
        self._conn.execute(f"""
            CREATE TABLE IF NOT EXISTS {self._table_name} (
                id TEXT PRIMARY KEY,
                text TEXT NOT NULL,
                embedding BLOB NOT NULL,
                metadata TEXT DEFAULT '{{}}'
            )
        """)
        self._conn.commit()
        logger.info("LocalVectorStore connected: %s", self._db_path)

    def close(self) -> None:
        """Close the database connection."""
        if self._conn is not None:
            self._conn.close()
            self._conn = None

    def _ensure_connected(self) -> sqlite3.Connection:
        if self._conn is None:
            self.connect()
        assert self._conn is not None
        return self._conn

    # ------------------------------------------------------------------
    # Insert
    # ------------------------------------------------------------------

    def add(
        self,
        text: str,
        embedding: np.ndarray,
        metadata: dict[str, Any] | None = None,
        record_id: str | None = None,
    ) -> str:
        """Insert a single record into the store.

        The embedding is L2-normalized before storage so retrieval can use
        a simple dot product instead of full cosine similarity.

        Args:
            text: Document chunk text.
            embedding: Dense vector (any dimensionality).
            metadata: Arbitrary JSON-serializable metadata dict.
            record_id: Optional explicit ID; auto-generated UUID4 if omitted.

        Returns:
            The record ID (generated or provided).
        """
        conn = self._ensure_connected()
        record_id = record_id or uuid.uuid4().hex
        norm = np.linalg.norm(embedding)
        if norm > 0:
            embedding = embedding / norm
        blob = embedding.astype(np.float32).tobytes()
        meta_json = json.dumps(metadata or {})
        conn.execute(
            f"INSERT OR REPLACE INTO {self._table_name} (id, text, embedding, metadata) "
            f"VALUES (?, ?, ?, ?)",
            (record_id, text, blob, meta_json),
        )
        conn.commit()
        return record_id

    def add_batch(
        self,
        texts: list[str],
        embeddings: list[np.ndarray],
        metadatas: list[dict[str, Any]] | None = None,
        ids: list[str] | None = None,
    ) -> list[str]:
        """Insert multiple records in a single transaction.

        Args:
            texts: List of document chunk texts.
            embeddings: Corresponding embedding vectors.
            metadatas: Per-record metadata dicts (optional).
            ids: Explicit record IDs (optional).

        Returns:
            List of record IDs.
        """
        conn = self._ensure_connected()
        if metadatas is None:
            metadatas = [{} for _ in texts]
        if ids is None:
            ids = [uuid.uuid4().hex for _ in texts]

        rows: list[tuple[str, str, bytes, str]] = []
        for rec_id, text, emb, meta in zip(ids, texts, embeddings, metadatas):
            norm = np.linalg.norm(emb)
            if norm > 0:
                emb = emb / norm
            blob = emb.astype(np.float32).tobytes()
            rows.append((rec_id, text, blob, json.dumps(meta)))

        conn.executemany(
            f"INSERT OR REPLACE INTO {self._table_name} (id, text, embedding, metadata) "
            f"VALUES (?, ?, ?, ?)",
            rows,
        )
        conn.commit()
        logger.info("Inserted %d records into local vector store", len(rows))
        return ids

    # ------------------------------------------------------------------
    # Search
    # ------------------------------------------------------------------

    def search(
        self,
        query_embedding: np.ndarray,
        top_k: int = 5,
        filters: dict[str, Any] | None = None,
    ) -> list[VectorRecord]:
        """Find the top-k most similar records by cosine similarity.

        Because stored embeddings are L2-normalized, cosine similarity equals
        the dot product, so we skip the denominator.

        Args:
            query_embedding: The query vector (will be L2-normalized).
            top_k: Number of results to return.
            filters: Optional metadata key-value pairs to filter on. A record
                must match ALL provided filters to be included.

        Returns:
            List of VectorRecord objects sorted by descending similarity.
        """
        conn = self._ensure_connected()
        norm = np.linalg.norm(query_embedding)
        if norm > 0:
            query_embedding = query_embedding / norm
        query_f32 = query_embedding.astype(np.float32)
        dim = query_f32.shape[0]

        cursor = conn.execute(
            f"SELECT id, text, embedding, metadata FROM {self._table_name}"
        )

        results: list[VectorRecord] = []
        for row_id, text, blob, meta_json in cursor:
            # Deserialize embedding
            stored = np.frombuffer(blob, dtype=np.float32)
            if stored.shape[0] != dim:
                continue  # dimension mismatch, skip

            # Check metadata filters
            meta: dict[str, Any] = json.loads(meta_json) if meta_json else {}
            if filters:
                skip = False
                for fk, fv in filters.items():
                    if str(meta.get(fk, "")) != str(fv):
                        skip = True
                        break
                if skip:
                    continue

            # Cosine similarity via dot product (both vectors are L2-normalized)
            sim = float(np.dot(query_f32, stored))
            results.append(VectorRecord(
                id=row_id,
                text=text,
                embedding=stored,
                metadata=meta,
                similarity=sim,
            ))

        # Sort descending by similarity and take top-k
        results.sort(key=lambda r: r.similarity, reverse=True)
        return results[:top_k]

    # ------------------------------------------------------------------
    # Utilities
    # ------------------------------------------------------------------

    def count(self) -> int:
        """Return the total number of records in the store."""
        conn = self._ensure_connected()
        row = conn.execute(
            f"SELECT COUNT(*) FROM {self._table_name}"
        ).fetchone()
        return row[0] if row else 0

    def delete(self, record_id: str) -> bool:
        """Delete a record by ID. Returns True if a record was deleted."""
        conn = self._ensure_connected()
        cursor = conn.execute(
            f"DELETE FROM {self._table_name} WHERE id = ?", (record_id,)
        )
        conn.commit()
        return cursor.rowcount > 0

    def delete_by_source(self, source_pdf: str) -> int:
        """Delete all records whose metadata.source_pdf matches *source_pdf*.

        This is useful for re-indexing a single PDF without clearing
        the entire store.

        Args:
            source_pdf: The source_pdf value stored in the metadata JSON.

        Returns:
            Number of records deleted.
        """
        conn = self._ensure_connected()
        cursor = conn.execute(
            f"DELETE FROM {self._table_name} "
            f"WHERE json_extract(metadata, '$.source_pdf') = ?",
            (source_pdf,),
        )
        conn.commit()
        deleted = cursor.rowcount
        if deleted:
            logger.info(
                "Deleted %d records for source: %s", deleted, source_pdf
            )
        return deleted

    def clear(self) -> int:
        """Delete all records. Returns the number of records deleted."""
        conn = self._ensure_connected()
        cursor = conn.execute(f"DELETE FROM {self._table_name}")
        conn.commit()
        return cursor.rowcount

    def list_sources(self) -> list[str]:
        """Return distinct source_pdf values from metadata."""
        conn = self._ensure_connected()
        cursor = conn.execute(
            f"SELECT DISTINCT json_extract(metadata, '$.source_pdf') "
            f"FROM {self._table_name} "
            f"WHERE json_extract(metadata, '$.source_pdf') IS NOT NULL"
        )
        return [row[0] for row in cursor if row[0]]

    def __enter__(self) -> LocalVectorStore:
        self.connect()
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()

    def __len__(self) -> int:
        return self.count()
