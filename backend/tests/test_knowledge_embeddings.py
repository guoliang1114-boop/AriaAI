from unittest.mock import Mock, patch

import pytest

from app.services import knowledge_embeddings as embeddings


def test_offline_vectors_have_an_honest_identity(monkeypatch):
    monkeypatch.setattr(embeddings.config, "KNOWLEDGE_EMBEDDING_PROVIDER", "hash")
    with patch.object(embeddings, "_get_model") as model:
        batch = embeddings.embed_texts(["预算审批"])
    assert batch.model_id == "aria-hash-v1:1536"
    assert batch.semantic is False
    assert len(batch.vectors[0]) == 1536
    model.assert_not_called()


def test_semantic_query_and_passage_use_distinct_model_interfaces(monkeypatch):
    monkeypatch.setattr(embeddings.config, "KNOWLEDGE_EMBEDDING_PROVIDER", "fastembed")
    model = Mock()
    model.query_embed.return_value = [[3.0, 4.0]]
    model.passage_embed.return_value = [[0.0, 2.0]]
    with patch.object(embeddings, "_get_model", return_value=model):
        query = embeddings.embed_texts(["谁批准"], query=True)
        passage = embeddings.embed_texts(["由财务负责人审批"])
    assert query.semantic and query.model_id == passage.model_id
    assert query.vectors[0][:2] == [0.6, 0.8]
    assert passage.vectors[0] == [0.0, 1.0] + [0.0] * 1534
    model.query_embed.assert_called_once_with(["谁批准"])
    model.passage_embed.assert_called_once_with(["由财务负责人审批"], batch_size=16)


@pytest.mark.parametrize("vectors", [[], [[0, 0]], [[float('nan')]], [[float('inf')]], [[1] * 1537]])
def test_invalid_model_output_fails_before_index_mutation(monkeypatch, vectors):
    monkeypatch.setattr(embeddings.config, "KNOWLEDGE_EMBEDDING_PROVIDER", "fastembed")
    model = Mock()
    model.passage_embed.return_value = vectors
    with patch.object(embeddings, "_get_model", return_value=model), pytest.raises(embeddings.KnowledgeEmbeddingError):
        embeddings.embed_texts(["客户资料"])


def test_model_failure_never_silently_creates_hash_vectors(monkeypatch):
    monkeypatch.setattr(embeddings.config, "KNOWLEDGE_EMBEDDING_PROVIDER", "fastembed")
    with patch.object(embeddings, "_get_model", side_effect=RuntimeError("private/path and source text")):
        with pytest.raises(embeddings.KnowledgeEmbeddingError) as error:
            embeddings.embed_texts(["资料"])
    assert str(error.value) == "Local knowledge embedding is unavailable"


def test_unknown_provider_cannot_mislabel_index(monkeypatch):
    monkeypatch.setattr(embeddings.config, "KNOWLEDGE_EMBEDDING_PROVIDER", "typo")
    with pytest.raises(embeddings.KnowledgeEmbeddingError):
        embeddings.embed_texts(["资料"])
