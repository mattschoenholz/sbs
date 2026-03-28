#!/usr/bin/env python3
"""
SailboatServer — RAG Document Indexer
Indexes PDFs from /var/www/html/docs/ into ~/rag_chunks.json + ~/rag_embeddings.npy

Run on the Pi:
  python3 ~/index_docs.py

Re-run whenever you add new documents. Takes ~1-3 min for a full rebuild.
Requires: pip3 install pypdf numpy requests
"""

import json
import os
import re
import sys
import time
import numpy as np
import requests
from pathlib import Path

# ── CONFIG ─────────────────────────────────────────────────────
DOCS_DIR    = Path("/var/www/html/docs")
OUTPUT_DIR  = Path.home()
CHUNKS_FILE = OUTPUT_DIR / "rag_chunks.json"
EMBED_FILE  = OUTPUT_DIR / "rag_embeddings.npy"

EMBED_MODEL  = "nomic-embed-text"
OLLAMA_URL   = "http://127.0.0.1:11434"
CHUNK_SIZE   = 600    # characters per chunk (≈ 150 tokens)
CHUNK_OVERLAP = 100   # character overlap between chunks

# ── HELPERS ────────────────────────────────────────────────────

def extract_pdf_pages(path: Path) -> list[tuple[int, str]]:
    """Return list of (page_num, text) tuples."""
    try:
        from pypdf import PdfReader
    except ImportError:
        print("  ✗ pypdf not installed. Run: pip3 install pypdf")
        sys.exit(1)
    try:
        reader = PdfReader(str(path))
        pages = []
        for i, page in enumerate(reader.pages, 1):
            text = page.extract_text() or ""
            text = re.sub(r'\s+', ' ', text).strip()
            if text:
                pages.append((i, text))
        return pages
    except Exception as e:
        print(f"  ✗ Failed to read {path.name}: {e}")
        return []


def chunk_text(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """Split text into overlapping chunks at sentence/space boundaries."""
    chunks = []
    start = 0
    while start < len(text):
        end = min(start + size, len(text))
        # Extend to next sentence end if possible
        if end < len(text):
            for delim in ['. ', '? ', '! ', '\n']:
                pos = text.rfind(delim, start + size // 2, end + 100)
                if pos != -1:
                    end = pos + len(delim)
                    break
        chunk = text[start:end].strip()
        if len(chunk) > 50:  # skip tiny fragments
            chunks.append(chunk)
        start = end - overlap
        if start >= len(text):
            break
    return chunks


def embed(text: str) -> list[float]:
    """Get embedding vector from Ollama nomic-embed-text."""
    r = requests.post(
        f"{OLLAMA_URL}/api/embeddings",
        json={"model": EMBED_MODEL, "prompt": text},
        timeout=30
    )
    r.raise_for_status()
    return r.json()["embedding"]


def check_ollama():
    """Verify Ollama is running and nomic-embed-text is available."""
    try:
        r = requests.get(f"{OLLAMA_URL}/api/tags", timeout=5)
        models = [m["name"] for m in r.json().get("models", [])]
        if not any(m.startswith("nomic-embed-text") for m in models):
            print(f"nomic-embed-text not found. Pulling now...")
            os.system(f"ollama pull {EMBED_MODEL}")
    except Exception as e:
        print(f"✗ Ollama not reachable: {e}")
        sys.exit(1)


# ── MAIN ───────────────────────────────────────────────────────

def main():
    print("=" * 56)
    print("SailboatServer RAG Indexer")
    print("=" * 56)

    check_ollama()

    # Collect all PDFs
    pdf_files = sorted(DOCS_DIR.rglob("*.pdf"))
    if not pdf_files:
        print(f"No PDFs found in {DOCS_DIR}")
        sys.exit(0)

    print(f"Found {len(pdf_files)} PDFs in {DOCS_DIR}")
    print()

    all_chunks = []
    all_embeddings = []

    for pdf_path in pdf_files:
        rel = pdf_path.relative_to(DOCS_DIR)
        print(f"  [{len(all_chunks):4d}] {rel}")
        pages = extract_pdf_pages(pdf_path)
        if not pages:
            continue

        # Chunk each page independently so page numbers stay accurate
        doc_chunks = []
        for page_num, page_text in pages:
            for chunk_text_val in chunk_text(page_text):
                doc_chunks.append({
                    "source": str(rel),
                    "page": page_num,
                    "text": chunk_text_val,
                })

        print(f"         → {len(pages)} pages, {len(doc_chunks)} chunks", end="", flush=True)

        # Embed each chunk
        doc_embeddings = []
        for chunk in doc_chunks:
            try:
                vec = embed(chunk["text"])
                doc_embeddings.append(vec)
            except Exception as e:
                print(f"\n  ✗ Embed error on {rel} p{chunk['page']}: {e}")
                doc_embeddings.append([0.0] * 768)  # zero vector as fallback
        print(f", embedded ✓")

        all_chunks.extend(doc_chunks)
        all_embeddings.extend(doc_embeddings)

    if not all_chunks:
        print("No chunks produced.")
        sys.exit(0)

    # Save
    print()
    print(f"Saving {len(all_chunks)} chunks...")
    with open(CHUNKS_FILE, "w") as f:
        json.dump({
            "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "model": EMBED_MODEL,
            "count": len(all_chunks),
            "chunks": all_chunks,
        }, f)

    matrix = np.array(all_embeddings, dtype=np.float32)
    np.save(EMBED_FILE, matrix)

    print(f"✓ rag_chunks.json  ({CHUNKS_FILE.stat().st_size // 1024} KB)")
    print(f"✓ rag_embeddings.npy  ({EMBED_FILE.stat().st_size // 1024} KB, shape {matrix.shape})")
    print()
    print("Index ready. Restart relay.service to reload:")
    print("  sudo systemctl restart relay.service")
    print("=" * 56)


if __name__ == "__main__":
    main()
