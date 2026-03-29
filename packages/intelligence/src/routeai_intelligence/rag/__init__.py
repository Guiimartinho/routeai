"""RAG module - Retrieval-Augmented Generation for PCB design knowledge.

Provides document indexing, embedding generation, and similarity-based retrieval
for IPC standards, manufacturer datasheets, and reference designs.

Two storage backends are available:

- **PostgreSQL + pgvector** (server): ``KnowledgeRetriever`` / ``DocumentIndexer``
- **SQLite** (desktop / offline): ``DatasheetRAG`` / ``LocalVectorStore``
"""

from routeai_intelligence.rag.datasheet_rag import (
    DatasheetRAG,
    RAGAnswer,
    SourceCitation,
)
from routeai_intelligence.rag.embeddings import EmbeddingPipeline
from routeai_intelligence.rag.indexer import DocumentIndexer
from routeai_intelligence.rag.local_vectorstore import LocalVectorStore, VectorRecord
from routeai_intelligence.rag.retriever import KnowledgeRetriever, RetrievedDocument

__all__ = [
    "DatasheetRAG",
    "DocumentIndexer",
    "EmbeddingPipeline",
    "KnowledgeRetriever",
    "LocalVectorStore",
    "RAGAnswer",
    "RetrievedDocument",
    "SourceCitation",
    "VectorRecord",
]
