"""Document indexer for the PCB design knowledge base.

Indexes IPC standards, manufacturer datasheets, and reference designs into
the pgvector-backed knowledge base. Handles document parsing, section
extraction, chunking, embedding, and storage.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


class DocumentIndexer:
    """Indexes documents into the pgvector knowledge base.

    Parses documents, extracts meaningful sections, chunks them for embedding,
    and stores the embedded chunks in PostgreSQL with pgvector for later
    retrieval by the KnowledgeRetriever.

    Supported document types:
    - IPC standards (text/PDF with clause numbering)
    - Manufacturer datasheets (text/PDF with typical sections)
    - Reference designs (KiCad/Eagle project files with design notes)

    Args:
        connection_string: PostgreSQL connection string.
        table_name: Embeddings table name.
    """

    def __init__(
        self,
        connection_string: str | None = None,
        table_name: str = "document_embeddings",
    ) -> None:
        self._connection_string = connection_string
        self._table_name = table_name
        self._pool: Any = None
        self._embedding_pipeline: Any = None

    async def _ensure_connection(self) -> None:
        """Establish database connection and ensure table exists."""
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

            # Ensure pgvector extension and table exist
            async with self._pool.acquire() as conn:
                await conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
                await conn.execute(f"""
                    CREATE TABLE IF NOT EXISTS {self._table_name} (
                        id SERIAL PRIMARY KEY,
                        content TEXT NOT NULL,
                        source TEXT NOT NULL,
                        metadata JSONB DEFAULT '{{}}'::jsonb,
                        embedding vector(1536),
                        created_at TIMESTAMP DEFAULT NOW()
                    )
                """)
                # Create an IVFFlat index for approximate nearest neighbor search
                await conn.execute(f"""
                    CREATE INDEX IF NOT EXISTS idx_{self._table_name}_embedding
                    ON {self._table_name}
                    USING ivfflat (embedding vector_cosine_ops)
                    WITH (lists = 100)
                """)

            logger.info("Database connection established and table verified")

        except Exception as exc:
            logger.error("Failed to connect to database: %s", exc)
            self._pool = None
            raise

    async def _ensure_embedding_pipeline(self) -> None:
        """Initialize the embedding pipeline."""
        if self._embedding_pipeline is not None:
            return

        from routeai_intelligence.rag.embeddings import EmbeddingPipeline
        self._embedding_pipeline = EmbeddingPipeline()

    async def index_document(
        self,
        filepath: str | Path,
        doc_type: str,
        metadata: dict[str, Any] | None = None,
    ) -> int:
        """Index a generic document into the knowledge base.

        Reads the file, chunks it, embeds the chunks, and stores them.

        Args:
            filepath: Path to the document file (text or PDF).
            doc_type: Document type identifier (e.g., 'ipc', 'datasheet', 'reference').
            metadata: Additional metadata to store with each chunk.

        Returns:
            Number of chunks indexed.
        """
        await self._ensure_connection()
        await self._ensure_embedding_pipeline()

        filepath = Path(filepath)
        if not filepath.exists():
            raise FileNotFoundError(f"Document not found: {filepath}")

        text = self._read_document(filepath)
        base_metadata = {
            "domain": doc_type,
            "filename": filepath.name,
            "filepath": str(filepath),
            **(metadata or {}),
        }

        embedded_chunks = await self._embedding_pipeline.embed_document(
            text=text,
            metadata=base_metadata,
        )

        if not embedded_chunks:
            logger.warning("No chunks generated from %s", filepath)
            return 0

        count = await self._store_chunks(embedded_chunks, str(filepath))
        logger.info("Indexed %d chunks from %s", count, filepath)
        return count

    async def index_ipc_standard(
        self,
        filepath: str | Path,
        standard_id: str | None = None,
    ) -> int:
        """Index an IPC standard document with clause-aware parsing.

        Extracts individual clauses, tables, and figures as separate chunks
        with structured metadata for precise retrieval.

        Args:
            filepath: Path to the IPC standard document.
            standard_id: Standard identifier (e.g., 'IPC-2221B'). Auto-detected if None.

        Returns:
            Number of chunks indexed.
        """
        await self._ensure_connection()
        await self._ensure_embedding_pipeline()

        filepath = Path(filepath)
        text = self._read_document(filepath)

        if standard_id is None:
            standard_id = self._detect_ipc_standard_id(text, filepath.name)

        # Parse IPC-specific sections (clauses, tables, figures)
        sections = self._parse_ipc_sections(text)

        all_chunks = []
        for section in sections:
            section_metadata = {
                "domain": "ipc",
                "standard": standard_id,
                "filename": filepath.name,
                "section_type": section["type"],
                "section_id": section.get("id", ""),
                "section_title": section.get("title", ""),
            }

            chunks = await self._embedding_pipeline.embed_document(
                text=section["text"],
                metadata=section_metadata,
            )
            all_chunks.extend(chunks)

        if not all_chunks:
            return 0

        count = await self._store_chunks(all_chunks, f"{standard_id}:{filepath.name}")
        logger.info("Indexed %d chunks from IPC standard %s", count, standard_id)
        return count

    async def index_datasheet(
        self,
        filepath: str | Path,
        component_name: str | None = None,
        manufacturer: str | None = None,
    ) -> int:
        """Index a component datasheet with section-aware parsing.

        Extracts key datasheet sections (features, electrical characteristics,
        absolute maximum ratings, pin descriptions, layout guidelines, package
        info) as separate chunks with rich metadata.

        Args:
            filepath: Path to the datasheet document.
            component_name: Component part number. Auto-detected if None.
            manufacturer: Manufacturer name. Auto-detected if None.

        Returns:
            Number of chunks indexed.
        """
        await self._ensure_connection()
        await self._ensure_embedding_pipeline()

        filepath = Path(filepath)
        text = self._read_document(filepath)

        # Parse datasheet sections
        sections = self._parse_datasheet_sections(text)

        all_chunks = []
        for section in sections:
            section_metadata = {
                "domain": "manufacturer",
                "doc_type": "datasheet",
                "component": component_name or "unknown",
                "manufacturer": manufacturer or "unknown",
                "filename": filepath.name,
                "section": section.get("section_name", ""),
            }

            chunks = await self._embedding_pipeline.embed_document(
                text=section["text"],
                metadata=section_metadata,
            )
            all_chunks.extend(chunks)

        if not all_chunks:
            return 0

        count = await self._store_chunks(
            all_chunks, f"datasheet:{component_name or filepath.stem}"
        )
        logger.info(
            "Indexed %d chunks from datasheet for %s",
            count,
            component_name or filepath.stem,
        )
        return count

    async def index_reference_design(
        self,
        filepath: str | Path,
        design_name: str | None = None,
    ) -> int:
        """Index a reference design document or project.

        Extracts design notes, component choices, layout guidelines, and
        constraint definitions from reference design files.

        Args:
            filepath: Path to the reference design document/project.
            design_name: Reference design name. Auto-detected if None.

        Returns:
            Number of chunks indexed.
        """
        await self._ensure_connection()
        await self._ensure_embedding_pipeline()

        filepath = Path(filepath)
        text = self._read_document(filepath)

        base_metadata = {
            "domain": "reference_design",
            "design_name": design_name or filepath.stem,
            "filename": filepath.name,
        }

        embedded_chunks = await self._embedding_pipeline.embed_document(
            text=text,
            metadata=base_metadata,
        )

        if not embedded_chunks:
            return 0

        count = await self._store_chunks(
            embedded_chunks, f"refdesign:{design_name or filepath.stem}"
        )
        logger.info("Indexed %d chunks from reference design %s", count, design_name)
        return count

    # ------------------------------------------------------------------
    # Storage
    # ------------------------------------------------------------------

    async def _store_chunks(self, embedded_chunks: list, source: str) -> int:
        """Store embedded chunks in the database."""
        if self._pool is None:
            logger.error("No database connection available")
            return 0

        count = 0
        async with self._pool.acquire() as conn:
            for ec in embedded_chunks:
                embedding_str = (
                    "[" + ",".join(str(float(x)) for x in ec.embedding) + "]"
                )
                metadata_json = json.dumps(ec.metadata, default=str)

                await conn.execute(
                    f"""
                    INSERT INTO {self._table_name} (content, source, metadata, embedding)
                    VALUES ($1, $2, $3::jsonb, $4::vector)
                    """,
                    ec.text,
                    source,
                    metadata_json,
                    embedding_str,
                )
                count += 1

        return count

    # ------------------------------------------------------------------
    # Document reading and parsing
    # ------------------------------------------------------------------

    @staticmethod
    def _read_document(filepath: Path) -> str:
        """Read a document file, handling text and common formats."""
        suffix = filepath.suffix.lower()

        if suffix in (".txt", ".md", ".rst", ".csv"):
            return filepath.read_text(encoding="utf-8", errors="replace")

        if suffix == ".json":
            data = json.loads(filepath.read_text(encoding="utf-8"))
            return json.dumps(data, indent=2)

        if suffix == ".pdf":
            try:
                import fitz  # PyMuPDF

                doc = fitz.open(str(filepath))
                pages = []
                for page in doc:
                    pages.append(page.get_text())
                doc.close()
                return "\n\n".join(pages)
            except ImportError:
                logger.warning(
                    "PyMuPDF not installed. Cannot parse PDF files. "
                    "Install with: pip install PyMuPDF"
                )
                return ""

        # Fallback: try reading as text
        try:
            return filepath.read_text(encoding="utf-8", errors="replace")
        except Exception:
            logger.error("Cannot read file: %s", filepath)
            return ""

    @staticmethod
    def _detect_ipc_standard_id(text: str, filename: str) -> str:
        """Try to detect the IPC standard identifier from text or filename."""
        # Check filename first
        match = re.search(r"IPC[-_\s]?\d{4}[A-Z]?", filename, re.IGNORECASE)
        if match:
            return match.group().replace("_", "-").replace(" ", "-").upper()

        # Check document text
        match = re.search(r"IPC[-\s]?\d{4}[A-Z]?", text[:2000], re.IGNORECASE)
        if match:
            return match.group().replace(" ", "-").upper()

        return "IPC-UNKNOWN"

    @staticmethod
    def _parse_ipc_sections(text: str) -> list[dict[str, str]]:
        """Parse an IPC standard into clause-based sections."""
        sections: list[dict[str, str]] = []

        # Match numbered clauses: "4.1 General Requirements"
        clause_pattern = re.compile(
            r"^(\d+(?:\.\d+)*)\s+([A-Z][\w\s,/\-]+?)(?:\n|$)",
            re.MULTILINE,
        )

        matches = list(clause_pattern.finditer(text))

        if not matches:
            # No structured clauses found; treat as single section
            sections.append({
                "type": "full_document",
                "id": "",
                "title": "",
                "text": text,
            })
            return sections

        for i, match in enumerate(matches):
            clause_id = match.group(1)
            clause_title = match.group(2).strip()
            start = match.start()
            end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
            clause_text = text[start:end].strip()

            sections.append({
                "type": "clause",
                "id": clause_id,
                "title": clause_title,
                "text": clause_text,
            })

        # Also extract tables
        table_pattern = re.compile(
            r"(Table\s+\d+[-\d]*\s*[-–:]\s*[^\n]+)\n((?:.*\n)*?(?=\n\n|\nTable\s|\n\d+\.\d+))",
            re.MULTILINE,
        )
        for match in table_pattern.finditer(text):
            table_title = match.group(1).strip()
            table_content = match.group(0).strip()
            table_id = re.search(r"Table\s+(\d+[-\d]*)", table_title)

            sections.append({
                "type": "table",
                "id": f"Table-{table_id.group(1)}" if table_id else "Table",
                "title": table_title,
                "text": table_content,
            })

        return sections

    @staticmethod
    def _parse_datasheet_sections(text: str) -> list[dict[str, str]]:
        """Parse a datasheet into recognized sections."""
        # Common datasheet section headers
        section_keywords = [
            "features",
            "applications",
            "description",
            "absolute maximum ratings",
            "recommended operating conditions",
            "electrical characteristics",
            "switching characteristics",
            "timing diagrams",
            "pin configuration",
            "pin description",
            "functional description",
            "application information",
            "layout guidelines",
            "layout recommendations",
            "pcb layout",
            "package information",
            "ordering information",
            "typical application",
            "block diagram",
            "thermal information",
            "power supply",
        ]

        # Build a regex that matches any of these section headers
        header_alternatives = "|".join(
            re.escape(kw) for kw in section_keywords
        )
        section_pattern = re.compile(
            rf"^[\s\d.]*({header_alternatives})\s*$",
            re.MULTILINE | re.IGNORECASE,
        )

        matches = list(section_pattern.finditer(text))
        sections: list[dict[str, str]] = []

        if not matches:
            sections.append({
                "section_name": "full_document",
                "text": text,
            })
            return sections

        for i, match in enumerate(matches):
            section_name = match.group(1).strip().lower().replace(" ", "_")
            start = match.start()
            end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
            section_text = text[start:end].strip()

            sections.append({
                "section_name": section_name,
                "text": section_text,
            })

        return sections

    async def close(self) -> None:
        """Close the database connection pool."""
        if self._pool is not None:
            await self._pool.close()
            self._pool = None
