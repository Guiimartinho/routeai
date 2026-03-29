#!/usr/bin/env python3
"""Index PCB component datasheets into the local SQLite vector store.

Scans a directory for PDF files, extracts text, chunks it, generates
embeddings, and stores everything in a local SQLite database that the
DatasheetRAG pipeline can query offline.

Usage:
    python scripts/index_datasheets.py data/datasheets/
    python scripts/index_datasheets.py data/datasheets/ --db data/datasheet_index.db
    python scripts/index_datasheets.py data/datasheets/ --force   # re-index all
    python scripts/index_datasheets.py --status                   # show index status

Requirements (at least one PDF library):
    pip install PyMuPDF          # recommended
    pip install pdfplumber       # alternative

Optional (better embeddings):
    pip install sentence-transformers
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

# ---------------------------------------------------------------------------
# Ensure the packages are importable when running from repo root
# ---------------------------------------------------------------------------
_REPO_ROOT = Path(__file__).resolve().parent.parent
_PACKAGES = [
    _REPO_ROOT / "packages" / "intelligence" / "src",
    _REPO_ROOT / "packages" / "core" / "src",
    _REPO_ROOT / "packages" / "solver" / "src",
]
for _pkg in _PACKAGES:
    _pkg_str = str(_pkg)
    if _pkg_str not in sys.path:
        sys.path.insert(0, _pkg_str)


def _progress_bar(current: int, total: int, filename: str, width: int = 40) -> None:
    """Print a simple progress bar to stderr."""
    if total == 0:
        return
    pct = current / total
    filled = int(width * pct)
    bar = "=" * filled + "-" * (width - filled)
    status = filename if len(filename) <= 40 else f"...{filename[-37:]}"
    print(f"\r  [{bar}] {current}/{total}  {status:<42}", end="", file=sys.stderr)
    if current == total:
        print(file=sys.stderr)  # newline when done


def cmd_index(args: argparse.Namespace) -> int:
    """Index all PDFs in the given directory."""
    from routeai_intelligence.rag.datasheet_rag import DatasheetRAG

    directory = Path(args.directory).resolve()
    if not directory.is_dir():
        print(f"ERROR: Not a directory: {directory}", file=sys.stderr)
        return 1

    db_path = Path(args.db).resolve()
    manifest_path = db_path.with_suffix(".json")

    print("=" * 60)
    print("RouteAI Datasheet Indexer")
    print("=" * 60)
    print(f"  Source directory : {directory}")
    print(f"  Database         : {db_path}")
    print(f"  Manifest         : {manifest_path}")
    print(f"  Force re-index   : {args.force}")
    print()

    # Count PDFs first
    pdf_files = sorted(directory.glob("**/*.pdf"))
    if not pdf_files:
        print("No PDF files found in the directory.")
        return 0

    print(f"Found {len(pdf_files)} PDF file(s).\n")

    t0 = time.monotonic()

    with DatasheetRAG(
        db_path=str(db_path),
        index_path=str(manifest_path),
    ) as rag:
        results = rag.ingest_directory(
            directory=directory,
            force=args.force,
            progress_callback=_progress_bar,
        )

    elapsed = time.monotonic() - t0

    # Summary
    print()
    print("-" * 60)
    total_chunks = sum(results.values())
    indexed_count = sum(1 for n in results.values() if n > 0)
    skipped_count = sum(1 for n in results.values() if n == 0)

    print(f"  PDFs processed   : {len(results)}")
    print(f"  PDFs indexed     : {indexed_count}")
    print(f"  PDFs skipped     : {skipped_count}")
    print(f"  Total chunks     : {total_chunks}")
    print(f"  Time elapsed     : {elapsed:.1f}s")
    print()

    if args.verbose:
        print("Per-file details:")
        for filename, num_chunks in sorted(results.items()):
            status = f"{num_chunks} chunks" if num_chunks > 0 else "skipped"
            print(f"  {filename:<50} {status}")
        print()

    print("Done. Query with:")
    print(f'  DatasheetRAG(db_path="{db_path}").query("your question")')

    return 0


def cmd_status(args: argparse.Namespace) -> int:
    """Show the current index status."""
    from routeai_intelligence.rag.datasheet_rag import DatasheetRAG

    db_path = Path(args.db).resolve()
    manifest_path = db_path.with_suffix(".json")

    if not db_path.exists():
        print(f"No database found at {db_path}")
        return 0

    with DatasheetRAG(
        db_path=str(db_path),
        index_path=str(manifest_path),
    ) as rag:
        info = rag.status()

    print("=" * 60)
    print("RouteAI Datasheet Index Status")
    print("=" * 60)
    print(f"  Database path    : {info['vector_store_path']}")
    print(f"  Total chunks     : {info['total_chunks']}")
    print(f"  Indexed PDFs     : {info['indexed_pdfs']}")
    print(f"  Embedding backend: {info['embedding_backend']}")
    print(f"  LLM model        : {info['ollama_model']}")

    sources = info.get("sources", [])
    if sources:
        print(f"\n  Indexed sources ({len(sources)}):")
        for src in sources:
            name = Path(src).name if src else "(unknown)"
            print(f"    - {name}")

    return 0


def cmd_query(args: argparse.Namespace) -> int:
    """Run a quick test query against the index."""
    from routeai_intelligence.rag.datasheet_rag import DatasheetRAG

    db_path = Path(args.db).resolve()
    manifest_path = db_path.with_suffix(".json")

    if not db_path.exists():
        print(f"No database found at {db_path}. Index some datasheets first.")
        return 1

    question = " ".join(args.question)
    if not question:
        print("Please provide a question.", file=sys.stderr)
        return 1

    with DatasheetRAG(
        db_path=str(db_path),
        index_path=str(manifest_path),
    ) as rag:
        # Retrieve only (no LLM call) for quick testing
        records = rag.retrieve(query=question, top_k=args.top_k)

    if not records:
        print("No relevant chunks found.")
        return 0

    print(f"Top {len(records)} results for: \"{question}\"\n")
    for i, rec in enumerate(records, 1):
        meta = rec.metadata
        source = Path(meta.get("source_pdf", "unknown")).name
        page = meta.get("page_number", "?")
        section = meta.get("section", "general")
        sim = rec.similarity

        print(f"[{i}] sim={sim:.4f}  |  {source}  p.{page}  ({section})")
        # Show first 200 chars of the chunk
        excerpt = rec.text[:200].replace("\n", " ")
        print(f"    {excerpt}...")
        print()

    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Index PCB datasheets into the local RAG vector store.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python scripts/index_datasheets.py data/datasheets/\n"
            "  python scripts/index_datasheets.py data/datasheets/ --force\n"
            "  python scripts/index_datasheets.py --status\n"
            "  python scripts/index_datasheets.py --query 'bypass capacitor for STM32'\n"
        ),
    )

    parser.add_argument(
        "directory",
        nargs="?",
        default=None,
        help="Directory containing PDF datasheets to index.",
    )
    parser.add_argument(
        "--db",
        default="data/datasheet_index.db",
        help="Path to the SQLite vector store database (default: data/datasheet_index.db).",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-index all PDFs even if unchanged.",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Show per-file indexing details.",
    )
    parser.add_argument(
        "--status",
        action="store_true",
        help="Show index status and exit.",
    )
    parser.add_argument(
        "--query",
        nargs="*",
        dest="question",
        help="Run a test retrieval query against the index (no LLM call).",
    )
    parser.add_argument(
        "--top-k",
        type=int,
        default=5,
        help="Number of results to return for --query (default: 5).",
    )

    args = parser.parse_args()

    # Dispatch
    if args.status:
        return cmd_status(args)

    if args.question is not None:
        return cmd_query(args)

    if args.directory is None:
        parser.print_help()
        print("\nERROR: Please provide a directory or use --status / --query.", file=sys.stderr)
        return 1

    return cmd_index(args)


if __name__ == "__main__":
    sys.exit(main())
