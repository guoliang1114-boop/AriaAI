#!/usr/bin/env python3
"""Synthetic Chinese retrieval evaluation in an ephemeral in-memory database."""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlmodel import SQLModel, Session, create_engine

from app import config
from app.models.db import User
from app.models.knowledge import KnowledgeChunk, KnowledgeSource, KnowledgeV1Document
from app.services.knowledge_embeddings import embed_texts
from app.services.knowledge_retrieval import search_knowledge


def evaluate(*, semantic: bool = False) -> dict:
    previous_provider = config.KNOWLEDGE_EMBEDDING_PROVIDER
    config.KNOWLEDGE_EMBEDDING_PROVIDER = "fastembed" if semantic else "hash"
    try:
        return _evaluate()
    finally:
        config.KNOWLEDGE_EMBEDDING_PROVIDER = previous_provider


def _evaluate() -> dict:
    semantic = config.KNOWLEDGE_EMBEDDING_PROVIDER == "fastembed"
    fixtures = json.loads((Path(__file__).resolve().parents[1] / "tests/fixtures/knowledge_retrieval_zh.json").read_text(encoding="utf-8"))
    embedding_started = time.perf_counter()
    vectors = embed_texts([item["content"] for item in fixtures["documents"]])
    embedding_setup_ms = round((time.perf_counter() - embedding_started) * 1000, 2)
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    results = []
    try:
        with Session(engine) as session:
            actor = User(email="synthetic-eval@example.invalid", password_hash="not-a-login", is_active=True)
            session.add(actor)
            session.flush()
            source = KnowledgeSource(name="Synthetic evaluation", source_type="manual_upload", scope_type="user", owner_user_id=actor.id)
            session.add(source)
            session.flush()
            keys = {}
            for i, (item, vector) in enumerate(zip(fixtures["documents"], vectors.vectors)):
                doc = KnowledgeV1Document(source_id=source.id, title=item["key"], file_name=f"{i}.txt", file_type="txt",
                    path=f"synthetic/{i}", content_hash=f"{i:064x}", scope_type="user", status="indexed")
                session.add(doc)
                session.flush()
                keys[doc.id] = item["key"]
                session.add(KnowledgeChunk(document_id=doc.id, chunk_index=0, content=item["content"],
                    embedding_model=vectors.model_id, embedding=json.dumps(vector)))
            session.flush()
            for case in fixtures["cases"]:
                if case.get("semantic") and not semantic:
                    continue
                result = search_knowledge(session=session, user=actor, query=case["query"], top_k=1)
                actual = keys[result["chunks"][0]["document_id"]] if result["chunks"] else None
                results.append({"id": case["id"], "passed": actual == case["expected"],
                                "expected": case["expected"], "actual": actual,
                                "query_time_ms": result["query_time_ms"]})
        passed = sum(item["passed"] for item in results)
        durations = sorted(item["query_time_ms"] for item in results)
        return {"schema_version": 1, "synthetic": True, "content_included": False,
                "model_id": vectors.model_id, "case_count": len(results), "passed": passed,
                "embedding_setup_ms": embedding_setup_ms,
                "retrieval_latency": {
                    "sample_count": len(durations), "percentile_method": "nearest_rank",
                    "model_warmed_by_passage_embedding": semantic,
                    "p50_ms": durations[math.ceil(0.5 * len(durations)) - 1] if durations else None,
                    "p95_ms": durations[math.ceil(0.95 * len(durations)) - 1] if durations else None,
                },
                "top1_accuracy": round(passed / len(results), 4),
                "release_gate_passed": passed == len(results), "cases": results}
    finally:
        engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--semantic", action="store_true", help="Run local FastEmbed, downloading weights if needed")
    parser.add_argument("--enforce", action="store_true")
    args = parser.parse_args()
    report = evaluate(semantic=args.semantic)
    print(json.dumps(report, ensure_ascii=False))
    raise SystemExit(1 if args.enforce and not report["release_gate_passed"] else 0)
