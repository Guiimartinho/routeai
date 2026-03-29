"""RAG pipeline for PCB datasheets.

End-to-end pipeline that ingests PDF datasheets, embeds them into a local
vector store, retrieves relevant chunks for a user query, and generates
answers with source citations via a local LLM (Ollama).

Designed to run fully offline on a developer workstation:
- Embeddings: sentence-transformers (local), fallback to TF-IDF
- Vector store: SQLite via LocalVectorStore (no PostgreSQL needed)
- LLM: Ollama (local), no cloud API required

Usage:
    rag = DatasheetRAG(db_path="data/datasheet_index.db")
    rag.ingest_pdf("datasheets/STM32F103C8.pdf", component_name="STM32F103")
    answer = rag.query("What bypass capacitors does STM32F103 need?")
    print(answer.text)
    for src in answer.sources:
        print(f"  [{src.page}] {src.excerpt[:80]}...")
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from routeai_intelligence.rag.local_vectorstore import LocalVectorStore, VectorRecord

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# PDF text extraction (optional dependencies)
# ---------------------------------------------------------------------------

_PDF_BACKEND: str | None = None


def _extract_pdf_text(pdf_path: str | Path) -> list[dict[str, Any]]:
    """Extract text from a PDF, returning a list of {page, text} dicts.

    Tries PyMuPDF (fitz) first, then pdfplumber, then raises ImportError.
    """
    global _PDF_BACKEND  # noqa: PLW0603

    pdf_path = Path(pdf_path)
    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF not found: {pdf_path}")

    # Try PyMuPDF (fitz)
    if _PDF_BACKEND in (None, "fitz"):
        try:
            import fitz  # PyMuPDF

            pages: list[dict[str, Any]] = []
            with fitz.open(str(pdf_path)) as doc:
                for page_num, page in enumerate(doc):
                    text = page.get_text()
                    if text.strip():
                        pages.append({"page": page_num + 1, "text": text})
            _PDF_BACKEND = "fitz"
            return pages
        except ImportError:
            if _PDF_BACKEND == "fitz":
                raise
            pass  # try next

    # Try pdfplumber
    if _PDF_BACKEND in (None, "pdfplumber"):
        try:
            import pdfplumber

            pages = []
            with pdfplumber.open(str(pdf_path)) as pdf:
                for page_num, page in enumerate(pdf.pages):
                    text = page.extract_text() or ""
                    if text.strip():
                        pages.append({"page": page_num + 1, "text": text})
            _PDF_BACKEND = "pdfplumber"
            return pages
        except ImportError:
            if _PDF_BACKEND == "pdfplumber":
                raise
            pass

    raise ImportError(
        "No PDF backend available. Install one of:\n"
        "  pip install PyMuPDF     (recommended)\n"
        "  pip install pdfplumber"
    )


# ---------------------------------------------------------------------------
# Embedding backend (sentence-transformers or TF-IDF fallback)
# ---------------------------------------------------------------------------


class _EmbeddingBackend:
    """Abstraction over embedding backends."""

    def __init__(self, model_name: str = "all-MiniLM-L6-v2") -> None:
        self._model_name = model_name
        self._model: Any = None
        self._dim: int = 0
        self._backend: str = "uninitialized"

    @property
    def dim(self) -> int:
        self._ensure_loaded()
        return self._dim

    @property
    def backend_name(self) -> str:
        return self._backend

    def _ensure_loaded(self) -> None:
        if self._model is not None:
            return

        # Try sentence-transformers
        try:
            from sentence_transformers import SentenceTransformer

            self._model = SentenceTransformer(self._model_name)
            self._dim = self._model.get_sentence_embedding_dimension()
            self._backend = "sentence-transformers"
            logger.info(
                "Loaded sentence-transformers model '%s' (dim=%d)",
                self._model_name,
                self._dim,
            )
            return
        except ImportError:
            logger.info(
                "sentence-transformers not installed; falling back to TF-IDF."
            )

        # Fallback: TF-IDF via scikit-learn or manual
        try:
            from sklearn.feature_extraction.text import TfidfVectorizer

            self._model = TfidfVectorizer(
                max_features=384,
                sublinear_tf=True,
                strip_accents="unicode",
                stop_words="english",
            )
            self._dim = 384
            self._backend = "tfidf-sklearn"
            logger.info("Using TF-IDF embedding backend (dim=%d)", self._dim)
            return
        except ImportError:
            pass

        # Bare-bones hash-based fallback
        self._model = "hash_fallback"
        self._dim = 384
        self._backend = "hash-fallback"
        logger.warning(
            "No embedding library available. Using hash-based fallback. "
            "Install sentence-transformers for proper semantic search."
        )

    def embed(self, texts: list[str]) -> list[np.ndarray]:
        """Embed a list of texts. Returns L2-normalized vectors."""
        self._ensure_loaded()

        if self._backend == "sentence-transformers":
            embs = self._model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
            return [np.array(e, dtype=np.float32) for e in embs]

        if self._backend == "tfidf-sklearn":
            return self._tfidf_embed(texts)

        # hash fallback
        return [self._hash_embed(t) for t in texts]

    def embed_single(self, text: str) -> np.ndarray:
        """Embed a single text string."""
        return self.embed([text])[0]

    def _tfidf_embed(self, texts: list[str]) -> list[np.ndarray]:
        """Embed using TF-IDF. The vectorizer is fitted on the input corpus."""
        from sklearn.feature_extraction.text import TfidfVectorizer

        if isinstance(self._model, TfidfVectorizer):
            # Fit on the provided texts (incremental approach)
            try:
                matrix = self._model.fit_transform(texts)
            except ValueError:
                # Empty vocabulary
                return [np.zeros(self._dim, dtype=np.float32) for _ in texts]

            results: list[np.ndarray] = []
            for i in range(matrix.shape[0]):
                vec = np.zeros(self._dim, dtype=np.float32)
                row = matrix.getrow(i).toarray().flatten()
                vec[: len(row)] = row[: self._dim]
                norm = np.linalg.norm(vec)
                if norm > 0:
                    vec /= norm
                results.append(vec)
            return results

        return [self._hash_embed(t) for t in texts]

    def _hash_embed(self, text: str) -> np.ndarray:
        """Deterministic pseudo-embedding from text hash."""
        h = hashlib.sha256(text.encode()).digest()
        rng = np.random.RandomState(int.from_bytes(h[:4], "big"))
        vec = rng.randn(self._dim).astype(np.float32)
        norm = np.linalg.norm(vec)
        if norm > 0:
            vec /= norm
        return vec


# ---------------------------------------------------------------------------
# Section detection heuristics for datasheet PDFs
# ---------------------------------------------------------------------------

_SECTION_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("electrical_characteristics", re.compile(r"electrical\s+characteristics", re.I)),
    ("absolute_maximum_ratings", re.compile(r"absolute\s+maximum\s+rating", re.I)),
    ("pin_description", re.compile(r"pin\s+(description|configuration|assignment)", re.I)),
    ("power_supply", re.compile(r"power\s+supply|decoupling|bypass", re.I)),
    ("application_circuit", re.compile(r"application\s+(circuit|diagram|schematic|note)", re.I)),
    ("package_information", re.compile(r"package\s+(information|outline|dimension)", re.I)),
    ("ordering_information", re.compile(r"ordering\s+(information|code|guide)", re.I)),
    ("functional_description", re.compile(r"functional\s+description|overview|feature", re.I)),
    ("timing_characteristics", re.compile(r"timing\s+(characteristics|diagram|specification)", re.I)),
    ("thermal", re.compile(r"thermal\s+(characteristics|resistance|information)", re.I)),
]


def _detect_section(text: str) -> str:
    """Heuristically detect the datasheet section from chunk text."""
    for section_name, pattern in _SECTION_PATTERNS:
        if pattern.search(text[:500]):  # check beginning of chunk
            return section_name
    return "general"


def _detect_component_name(filename: str) -> str:
    """Extract a component name from a PDF filename.

    Examples:
        "STM32F103C8.pdf" -> "STM32F103"
        "LM1117-3.3_datasheet.pdf" -> "LM1117"
        "ADS1115IDGSR.pdf" -> "ADS1115"
    """
    stem = Path(filename).stem
    # Remove common suffixes
    stem = re.sub(r"[-_]?(datasheet|ds|rev\w*|v\d+).*$", "", stem, flags=re.I)
    # Try to extract the core part number (letters+digits prefix)
    match = re.match(r"([A-Za-z]+\d+[A-Za-z]?\d*)", stem)
    if match:
        return match.group(1).upper()
    return stem.upper()


# ---------------------------------------------------------------------------
# Chunking
# ---------------------------------------------------------------------------


def _chunk_pages(
    pages: list[dict[str, Any]],
    chunk_size: int = 512,
    chunk_overlap: int = 64,
    source_pdf: str = "",
    component_name: str = "",
) -> list[dict[str, Any]]:
    """Split extracted pages into metadata-tagged chunks.

    Each chunk gets: {text, metadata: {source_pdf, page_number, section, component_name}}

    Args:
        pages: List of {page, text} dicts from PDF extraction.
        chunk_size: Target chunk size in approximate tokens.
        chunk_overlap: Overlap in approximate tokens.
        source_pdf: Original PDF filename for metadata.
        component_name: Component part number.

    Returns:
        List of {text, metadata} dicts ready for embedding.
    """
    target_chars = chunk_size * 4  # ~4 chars per token
    overlap_chars = chunk_overlap * 4
    chunks: list[dict[str, Any]] = []

    for page_info in pages:
        page_num = page_info["page"]
        page_text = page_info["text"].strip()
        if not page_text:
            continue

        # Split page into paragraphs (double newline or section headers)
        paragraphs = re.split(r"\n{2,}|\n(?=[A-Z][A-Z\s]{4,}\n)", page_text)
        current_text = ""

        for para in paragraphs:
            para = para.strip()
            if not para:
                continue

            candidate = (current_text + "\n\n" + para).strip() if current_text else para

            if len(candidate) > target_chars and current_text:
                # Emit current chunk
                section = _detect_section(current_text)
                chunks.append({
                    "text": current_text,
                    "metadata": {
                        "source_pdf": source_pdf,
                        "page_number": page_num,
                        "section": section,
                        "component_name": component_name,
                    },
                })
                # Overlap: keep tail of current text
                if len(current_text) > overlap_chars:
                    current_text = current_text[-overlap_chars:]
                current_text = (current_text + "\n\n" + para).strip()
            else:
                current_text = candidate

        # Emit remaining text from this page
        if current_text.strip():
            section = _detect_section(current_text)
            chunks.append({
                "text": current_text,
                "metadata": {
                    "source_pdf": source_pdf,
                    "page_number": page_num,
                    "section": section,
                    "component_name": component_name,
                },
            })

    return chunks


# ---------------------------------------------------------------------------
# Datasheet index (JSON manifest)
# ---------------------------------------------------------------------------


@dataclass
class DatasheetIndexEntry:
    """An entry in the datasheet index manifest."""

    pdf_path: str
    component_name: str
    num_chunks: int
    num_pages: int
    content_hash: str


class DatasheetIndex:
    """JSON-backed index of ingested datasheets for fast reload.

    Tracks which PDFs have been indexed and their content hashes so we can
    skip re-indexing unchanged files.
    """

    def __init__(self, index_path: str | Path = "datasheet_manifest.json") -> None:
        self._path = Path(index_path)
        self._entries: dict[str, DatasheetIndexEntry] = {}
        self._load()

    def _load(self) -> None:
        if self._path.exists():
            try:
                data = json.loads(self._path.read_text())
                for key, val in data.items():
                    self._entries[key] = DatasheetIndexEntry(**val)
                logger.info("Loaded datasheet index with %d entries", len(self._entries))
            except (json.JSONDecodeError, TypeError) as exc:
                logger.warning("Could not load datasheet index: %s", exc)
                self._entries = {}

    def save(self) -> None:
        """Persist the index to disk."""
        self._path.parent.mkdir(parents=True, exist_ok=True)
        data = {}
        for key, entry in self._entries.items():
            data[key] = {
                "pdf_path": entry.pdf_path,
                "component_name": entry.component_name,
                "num_chunks": entry.num_chunks,
                "num_pages": entry.num_pages,
                "content_hash": entry.content_hash,
            }
        self._path.write_text(json.dumps(data, indent=2))

    def get(self, pdf_path: str) -> DatasheetIndexEntry | None:
        return self._entries.get(pdf_path)

    def put(self, entry: DatasheetIndexEntry) -> None:
        self._entries[entry.pdf_path] = entry
        self.save()

    def needs_reindex(self, pdf_path: str | Path) -> bool:
        """Check if a PDF needs (re-)indexing based on content hash."""
        pdf_path = Path(pdf_path)
        if not pdf_path.exists():
            return False
        content_hash = hashlib.md5(pdf_path.read_bytes()).hexdigest()
        existing = self._entries.get(str(pdf_path))
        if existing is None:
            return True
        return existing.content_hash != content_hash

    @property
    def entries(self) -> dict[str, DatasheetIndexEntry]:
        return dict(self._entries)


# ---------------------------------------------------------------------------
# LLM integration (Ollama)
# ---------------------------------------------------------------------------


def _call_ollama(
    prompt: str,
    model: str = "llama3.2",
    base_url: str = "http://localhost:11434",
    timeout: float = 120.0,
) -> str:
    """Call the Ollama API to generate a response.

    Args:
        prompt: The full prompt to send.
        model: Ollama model name.
        base_url: Ollama server URL.
        timeout: Request timeout in seconds.

    Returns:
        Generated text response.
    """
    try:
        import httpx
    except ImportError:
        try:
            import urllib.request
            import urllib.error

            data = json.dumps({
                "model": model,
                "prompt": prompt,
                "stream": False,
            }).encode()
            req = urllib.request.Request(
                f"{base_url}/api/generate",
                data=data,
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                result = json.loads(resp.read().decode())
                return result.get("response", "")
        except Exception as exc:
            logger.error("Ollama request failed (urllib): %s", exc)
            return f"[LLM unavailable: {exc}]"

    try:
        response = httpx.post(
            f"{base_url}/api/generate",
            json={
                "model": model,
                "prompt": prompt,
                "stream": False,
            },
            timeout=timeout,
        )
        response.raise_for_status()
        return response.json().get("response", "")
    except Exception as exc:
        logger.error("Ollama request failed: %s", exc)
        return f"[LLM unavailable: {exc}]"


# ---------------------------------------------------------------------------
# RAG result dataclasses
# ---------------------------------------------------------------------------


@dataclass
class SourceCitation:
    """A source citation from a retrieved chunk."""

    source_pdf: str
    page: int
    section: str
    excerpt: str
    similarity: float


@dataclass
class RAGAnswer:
    """The final answer from the RAG pipeline."""

    text: str
    sources: list[SourceCitation] = field(default_factory=list)
    model: str = ""
    query: str = ""


# ---------------------------------------------------------------------------
# Main RAG pipeline
# ---------------------------------------------------------------------------


class DatasheetRAG:
    """Complete RAG pipeline for PCB datasheets.

    Combines PDF ingestion, local embedding, SQLite vector storage,
    similarity retrieval, and LLM-based answer generation.

    Args:
        db_path: Path to the SQLite vector store database.
        index_path: Path to the JSON datasheet index manifest.
        embedding_model: Name of the sentence-transformers model.
        ollama_model: Name of the Ollama model for answer generation.
        ollama_url: Base URL of the Ollama server.
        chunk_size: Target chunk size in approximate tokens.
        chunk_overlap: Overlap between consecutive chunks in tokens.
    """

    def __init__(
        self,
        db_path: str | Path = "data/datasheet_index.db",
        index_path: str | Path = "data/datasheet_manifest.json",
        embedding_model: str = "all-MiniLM-L6-v2",
        ollama_model: str = "llama3.2",
        ollama_url: str = "http://localhost:11434",
        chunk_size: int = 512,
        chunk_overlap: int = 64,
    ) -> None:
        self._store = LocalVectorStore(db_path=db_path)
        self._index = DatasheetIndex(index_path=index_path)
        self._embedder = _EmbeddingBackend(model_name=embedding_model)
        self._ollama_model = ollama_model
        self._ollama_url = ollama_url
        self._chunk_size = chunk_size
        self._chunk_overlap = chunk_overlap

    # ------------------------------------------------------------------
    # PDF Ingestion
    # ------------------------------------------------------------------

    def ingest_pdf(
        self,
        pdf_path: str | Path,
        component_name: str | None = None,
        force: bool = False,
    ) -> int:
        """Ingest a single PDF datasheet into the vector store.

        Extracts text, chunks it, generates embeddings, and stores
        everything in the local SQLite vector store.

        Args:
            pdf_path: Path to the PDF file.
            component_name: Component part number. Auto-detected from
                filename if not provided.
            force: Re-index even if the PDF has not changed.

        Returns:
            Number of chunks indexed.
        """
        pdf_path = Path(pdf_path).resolve()

        if not force and not self._index.needs_reindex(pdf_path):
            logger.info("Skipping unchanged PDF: %s", pdf_path.name)
            existing = self._index.get(str(pdf_path))
            return existing.num_chunks if existing else 0

        if component_name is None:
            component_name = _detect_component_name(pdf_path.name)

        logger.info(
            "Ingesting PDF: %s (component: %s)", pdf_path.name, component_name
        )

        # Extract text
        pages = _extract_pdf_text(pdf_path)
        if not pages:
            logger.warning("No text extracted from %s", pdf_path.name)
            return 0

        # Chunk
        chunks = _chunk_pages(
            pages,
            chunk_size=self._chunk_size,
            chunk_overlap=self._chunk_overlap,
            source_pdf=str(pdf_path),
            component_name=component_name,
        )
        if not chunks:
            logger.warning("No chunks produced from %s", pdf_path.name)
            return 0

        # Embed
        texts = [c["text"] for c in chunks]
        embeddings = self._embedder.embed(texts)

        # Store
        metadatas = [c["metadata"] for c in chunks]
        self._store.add_batch(
            texts=texts,
            embeddings=embeddings,
            metadatas=metadatas,
        )

        # Update index
        content_hash = hashlib.md5(pdf_path.read_bytes()).hexdigest()
        self._index.put(DatasheetIndexEntry(
            pdf_path=str(pdf_path),
            component_name=component_name,
            num_chunks=len(chunks),
            num_pages=len(pages),
            content_hash=content_hash,
        ))

        logger.info(
            "Indexed %d chunks from %s (%d pages)",
            len(chunks),
            pdf_path.name,
            len(pages),
        )
        return len(chunks)

    def ingest_directory(
        self,
        directory: str | Path,
        force: bool = False,
        progress_callback: Any = None,
    ) -> dict[str, int]:
        """Scan a directory for PDF files and index all of them.

        Auto-detects component names from filenames.

        Args:
            directory: Directory to scan for PDFs.
            force: Re-index all files even if unchanged.
            progress_callback: Optional callable(current, total, filename)
                for progress reporting.

        Returns:
            Dict mapping filename -> number of chunks indexed.
        """
        directory = Path(directory)
        if not directory.is_dir():
            raise NotADirectoryError(f"Not a directory: {directory}")

        pdf_files = sorted(directory.glob("**/*.pdf"))
        if not pdf_files:
            logger.warning("No PDF files found in %s", directory)
            return {}

        results: dict[str, int] = {}
        total = len(pdf_files)
        logger.info("Found %d PDF files in %s", total, directory)

        for idx, pdf_path in enumerate(pdf_files):
            if progress_callback:
                progress_callback(idx, total, pdf_path.name)

            try:
                num_chunks = self.ingest_pdf(pdf_path, force=force)
                results[pdf_path.name] = num_chunks
            except Exception as exc:
                logger.error("Failed to ingest %s: %s", pdf_path.name, exc)
                results[pdf_path.name] = 0

        if progress_callback:
            progress_callback(total, total, "done")

        total_chunks = sum(results.values())
        logger.info(
            "Indexed %d PDFs, %d total chunks", len(results), total_chunks
        )
        return results

    # ------------------------------------------------------------------
    # Retrieval
    # ------------------------------------------------------------------

    def retrieve(
        self,
        query: str,
        top_k: int = 5,
        component_name: str | None = None,
        section: str | None = None,
    ) -> list[VectorRecord]:
        """Retrieve the most relevant datasheet chunks for a query.

        Args:
            query: Natural language question about a component.
            top_k: Number of chunks to return.
            component_name: Filter results to a specific component.
            section: Filter results to a specific section type
                (e.g., "power_supply", "electrical_characteristics").

        Returns:
            List of VectorRecord objects sorted by descending similarity.
        """
        query_embedding = self._embedder.embed_single(query)

        filters: dict[str, Any] = {}
        if component_name:
            filters["component_name"] = component_name
        if section:
            filters["section"] = section

        return self._store.search(
            query_embedding=query_embedding,
            top_k=top_k,
            filters=filters if filters else None,
        )

    # ------------------------------------------------------------------
    # LLM-augmented answering
    # ------------------------------------------------------------------

    def query(
        self,
        question: str,
        top_k: int = 5,
        component_name: str | None = None,
        section: str | None = None,
    ) -> RAGAnswer:
        """Answer a question using retrieved datasheet excerpts + LLM.

        Pipeline:
        1. Retrieve top-k relevant chunks from the vector store
        2. Build a prompt with the chunks as context
        3. Call Ollama to generate an answer
        4. Return the answer with source citations

        Args:
            question: Natural language question about PCB components.
            top_k: Number of context chunks to retrieve.
            component_name: Optional component filter.
            section: Optional section filter.

        Returns:
            RAGAnswer with generated text and source citations.
        """
        # Step 1: Retrieve
        records = self.retrieve(
            query=question,
            top_k=top_k,
            component_name=component_name,
            section=section,
        )

        if not records:
            return RAGAnswer(
                text="No relevant datasheet information found. "
                     "Please index some datasheets first.",
                sources=[],
                model=self._ollama_model,
                query=question,
            )

        # Step 2: Build prompt
        context_parts: list[str] = []
        sources: list[SourceCitation] = []

        for i, rec in enumerate(records, 1):
            meta = rec.metadata
            source_pdf = meta.get("source_pdf", "unknown")
            page = meta.get("page_number", 0)
            section_name = meta.get("section", "general")
            excerpt = rec.text[:200].replace("\n", " ")

            context_parts.append(
                f"[{i}] Source: {Path(source_pdf).name}, Page {page}, "
                f"Section: {section_name}\n{rec.text}"
            )
            sources.append(SourceCitation(
                source_pdf=source_pdf,
                page=int(page),
                section=section_name,
                excerpt=excerpt,
                similarity=rec.similarity,
            ))

        context_block = "\n\n---\n\n".join(context_parts)
        prompt = (
            "You are a PCB design assistant. Answer the question using ONLY the "
            "datasheet excerpts provided below. If the excerpts do not contain "
            "enough information, say so. Always cite your sources using [N] "
            "notation.\n\n"
            f"Based on these datasheet excerpts:\n\n{context_block}\n\n"
            f"Question: {question}\n\n"
            "Answer:"
        )

        # Step 3: Call LLM
        answer_text = _call_ollama(
            prompt=prompt,
            model=self._ollama_model,
            base_url=self._ollama_url,
        )

        return RAGAnswer(
            text=answer_text,
            sources=sources,
            model=self._ollama_model,
            query=question,
        )

    # ------------------------------------------------------------------
    # Convenience / status
    # ------------------------------------------------------------------

    def status(self) -> dict[str, Any]:
        """Return a summary of the current RAG pipeline state."""
        return {
            "vector_store_path": str(self._store._db_path),
            "total_chunks": self._store.count(),
            "indexed_pdfs": len(self._index.entries),
            "embedding_backend": self._embedder.backend_name,
            "ollama_model": self._ollama_model,
            "sources": self._store.list_sources(),
        }

    def close(self) -> None:
        """Close the vector store connection."""
        self._store.close()

    def __enter__(self) -> "DatasheetRAG":
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()
