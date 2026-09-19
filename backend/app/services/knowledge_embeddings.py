"""Local knowledge embeddings with explicit identities and no silent mixing.

The existing pgvector column has 1536 dimensions. Zero padding a shorter local
vector preserves cosine similarity and avoids rewriting the database contract.
Old, ambiguously labelled hash vectors are deliberately lexical-only.
"""
from __future__ import annotations

import hashlib
import math
import threading
from dataclasses import dataclass
from typing import Callable

from app import config

STORAGE_DIMENSIONS = 1536
HASH_MODEL_ID = "aria-hash-v1:1536"
_models: dict[tuple[str, str, int], object] = {}
_model_lock = threading.RLock()


class KnowledgeEmbeddingError(RuntimeError):
    """Indexing must fail visibly rather than mislabel fallback vectors."""


@dataclass(frozen=True)
class EmbeddingBatch:
    model_id: str
    vectors: list[list[float]]
    semantic: bool


def deterministic_embedding(text: str, dimensions: int = STORAGE_DIMENSIONS) -> list[float]:
    vector = [0.0] * dimensions
    tokens = [token for token in (text or "").lower().split() if token] or [text[:64] or "empty"]
    for token in tokens:
        digest = hashlib.sha256(token.encode("utf-8", errors="ignore")).digest()
        vector[int.from_bytes(digest[:4], "big") % dimensions] += 1.0
    norm = math.sqrt(sum(value * value for value in vector)) or 1.0
    return [round(value / norm, 8) for value in vector]


def configured_model_id() -> str:
    if config.KNOWLEDGE_EMBEDDING_PROVIDER == "hash":
        return HASH_MODEL_ID
    if config.KNOWLEDGE_EMBEDDING_PROVIDER != "fastembed":
        raise KnowledgeEmbeddingError("Unsupported knowledge embedding provider")
    identity = f"fastembed-v1:{config.KNOWLEDGE_EMBEDDING_MODEL}:pad{STORAGE_DIMENSIONS}"
    if not config.KNOWLEDGE_EMBEDDING_MODEL or len(identity) > 100:
        raise KnowledgeEmbeddingError("Invalid knowledge embedding model identity")
    return identity


def _get_model():
    # Inference runs locally. Only model weights may be downloaded; document
    # bodies and queries never leave Aria for an embedding API.
    from fastembed import TextEmbedding

    key = (config.KNOWLEDGE_EMBEDDING_MODEL, str(config.KNOWLEDGE_EMBEDDING_CACHE_DIR),
           config.KNOWLEDGE_EMBEDDING_THREADS)
    with _model_lock:
        if key not in _models:
            _models[key] = TextEmbedding(model_name=key[0], cache_dir=key[1], threads=key[2])
        return _models[key]


def _normalize(vector) -> list[float]:
    values = [float(value) for value in vector]
    if not 1 <= len(values) <= STORAGE_DIMENSIONS or not all(math.isfinite(v) for v in values):
        raise KnowledgeEmbeddingError("Invalid knowledge embedding dimensions or values")
    norm = math.sqrt(sum(value * value for value in values))
    if not math.isfinite(norm) or norm <= 0:
        raise KnowledgeEmbeddingError("Knowledge embedding has no finite magnitude")
    return [value / norm for value in values] + [0.0] * (STORAGE_DIMENSIONS - len(values))


def embed_texts(texts: list[str], *, query: bool = False,
               hash_embed: Callable[[str], list[float]] = deterministic_embedding) -> EmbeddingBatch:
    identity = configured_model_id()
    if identity == HASH_MODEL_ID:
        return EmbeddingBatch(identity, [hash_embed(text) for text in texts], False)
    if not texts:
        return EmbeddingBatch(identity, [], True)
    try:
        with _model_lock:
            model = _get_model()
            vectors = list(model.query_embed(texts) if query else model.passage_embed(texts, batch_size=16))
        if len(vectors) != len(texts):
            raise KnowledgeEmbeddingError("Knowledge embedding result count mismatch")
        dimensions = {len(vector) for vector in vectors}
        if len(dimensions) != 1:
            raise KnowledgeEmbeddingError("Knowledge embedding result dimensions differ")
        return EmbeddingBatch(identity, [_normalize(vector) for vector in vectors], True)
    except KnowledgeEmbeddingError:
        raise
    except Exception as exc:
        # Provider exceptions can contain paths or document text. Persist only
        # a stable diagnostic; the failed job remains retryable and auditable.
        raise KnowledgeEmbeddingError("Local knowledge embedding is unavailable") from exc
