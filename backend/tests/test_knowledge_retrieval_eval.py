import json

import pytest

from scripts import knowledge_retrieval_eval as evaluation


def test_offline_gate_checks_actual_retrieval_with_bounded_content_free_timings(monkeypatch):
    monkeypatch.setattr(evaluation.config, "KNOWLEDGE_EMBEDDING_PROVIDER", "fastembed")
    report = evaluation.evaluate()
    assert report["release_gate_passed"] is True
    assert report["case_count"] == report["passed"] == 5
    unrelated = next(case for case in report["cases"] if case["id"] == "unrelated")
    assert unrelated["actual"] is None
    timings = report["retrieval_latency"]
    assert timings["sample_count"] == 5
    assert 0 <= timings["p50_ms"] <= timings["p95_ms"]
    assert report["embedding_setup_ms"] >= 0
    assert timings["model_warmed_by_passage_embedding"] is False
    assert evaluation.config.KNOWLEDGE_EMBEDDING_PROVIDER == "fastembed"
    assert "example.invalid" not in json.dumps(report)
    assert all(set(case) == {"id", "passed", "expected", "actual", "query_time_ms"} for case in report["cases"])


def test_failed_evaluation_restores_the_callers_embedding_configuration(monkeypatch):
    monkeypatch.setattr(evaluation.config, "KNOWLEDGE_EMBEDDING_PROVIDER", "hash")

    def unavailable(_texts):
        raise RuntimeError("model unavailable")

    monkeypatch.setattr(evaluation, "embed_texts", unavailable)
    with pytest.raises(RuntimeError, match="model unavailable"):
        evaluation.evaluate(semantic=True)
    assert evaluation.config.KNOWLEDGE_EMBEDDING_PROVIDER == "hash"
