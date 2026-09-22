#!/usr/bin/env python3
"""Evaluate local document copies in disposable storage and SQLite.

The private manifest contains documents [{path}] and cases [{query,
document_index, phrases}]. Indices are zero-based; document_index=null requires
no retrieval. Reports never contain paths, queries, excerpts or expected text.
No production database, job queue, business writes or generative model is used.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
import tempfile
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlmodel import SQLModel, Session, create_engine
from app import config
from app.models.db import User
from app.models.knowledge import KnowledgeSource
from app.services import knowledge_ingestion as ingestion
from app.services.knowledge_embeddings import configured_model_id
from app.services.knowledge_permissions import lock_and_require_source_document_write
from app.services.context_builder.rag_context import _source_scoped_results, _rag_payload
from app.services.agent_harness.knowledge_evidence import resolve_knowledge_citations


def _digest(value) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def _contains(text: str, phrases: list[str]) -> bool:
    normalized = "".join(text.split()).casefold()
    return all("".join(phrase.split()).casefold() in normalized for phrase in phrases)


def evaluate(manifest: dict, *, semantic: bool = False) -> dict:
    documents, cases = manifest["documents"], manifest["cases"]
    if not 1 <= len(documents) <= 20 or not 1 <= len(cases) <= 100:
        raise ValueError("Invalid evaluation size")
    for case in cases:
        index, phrases = case["document_index"], case["phrases"]
        if not isinstance(case["query"], str) or not case["query"].strip():
            raise ValueError("Invalid evaluation query")
        if index is not None and (type(index) is not int or not 0 <= index < len(documents)):
            raise ValueError("Invalid expected document")
        if not isinstance(phrases, list) or any(not isinstance(p, str) or not p.strip() for p in phrases):
            raise ValueError("Invalid expected phrases")
        if bool(phrases) != (index is not None):
            raise ValueError("Positive cases need expected evidence; negative cases must have none")
    previous_provider, previous_uploads = config.KNOWLEDGE_EMBEDDING_PROVIDER, ingestion.UPLOADS_DIR
    engine = create_engine("sqlite://")
    try:
        config.KNOWLEDGE_EMBEDDING_PROVIDER = "fastembed" if semantic else "hash"
        SQLModel.metadata.create_all(engine)
        with tempfile.TemporaryDirectory(prefix="aria-knowledge-eval-") as root, Session(engine) as session:
            ingestion.UPLOADS_DIR = Path(root)
            owner = User(email="owner@evaluation.invalid", password_hash="not-a-login", is_active=True)
            outsider = User(email="outsider@evaluation.invalid", password_hash="not-a-login", is_active=True)
            session.add_all([owner, outsider])
            session.flush()
            source = KnowledgeSource(name="Evaluation copies", source_type="manual_upload", scope_type="user", owner_user_id=owner.id)
            session.add(source)
            session.commit()
            ids, document_reports, source_texts = [], [], []
            for index, entry in enumerate(documents):
                path = Path(entry["path"])
                content = path.read_bytes()
                started = time.perf_counter()
                doc, _ = ingestion.register_document_from_bytes(
                    session=session, source=source, file_name=f"document-{index}{path.suffix.lower()}", content=content,
                )
                session.commit()
                document_id = int(doc.id)
                def authorize():
                    current_source, current_doc, _ = lock_and_require_source_document_write(session, int(source.id), document_id, owner)
                    return current_source, current_doc
                doc, _ = ingestion.index_document_actor_aware(session, document_id, final_authorize=authorize)
                session.commit()
                ids.append(document_id)
                source_texts.append(json.loads((Path(root) / doc.extracted_text_storage_key).read_text())["text"])
                document_reports.append({"document_index": index, "sha256": hashlib.sha256(content).hexdigest(),
                    "file_type": doc.file_type, "bytes": len(content), "pages": doc.page_count, "slides": doc.slide_count,
                    "chunks": doc.chunk_count, "indexed": doc.status == "indexed",
                    "index_elapsed_ms": round((time.perf_counter() - started) * 1000)})
            results = []
            for index, case in enumerate(cases):
                started = time.perf_counter()
                retrieved = _source_scoped_results(session=session, user=owner, query=case["query"], document_ids=ids)
                elapsed_ms = round((time.perf_counter() - started) * 1000)
                payload = _rag_payload(retrieved, query=case["query"], knowledge_scope="workspace", project_id=None,
                                       retrieval_mode="source_scoped", source_scoped_attempted=True)
                expected = case["document_index"]
                expectation_in_source = expected is None or _contains(source_texts[expected], case["phrases"])
                matching = [i for i, item in enumerate(retrieved) if expected is not None
                            and item.document_id == ids[expected] and _contains(item.content, case["phrases"])]
                evidence_present = bool(matching) if expected is not None else not retrieved
                prompt_present = _contains(payload["text"], case["phrases"]) if expected is not None else not payload["text"]
                citation_valid = not retrieved if expected is None else False
                if matching:
                    key = payload["evidence_manifest"]["entries"][matching[0]]["citation_key"]
                    resolved, references = resolve_knowledge_citations(payload["evidence_manifest"], f"Finding [{key}]")
                    citation_valid = (resolved["status"] == "cited" and len(references) == 1
                                      and references[0]["id"] == ids[expected]
                                      and references[0]["document_namespace"] == "source_scoped"
                                      and references[0]["knowledge_source_id"] == source.id)
                denied = not _source_scoped_results(session=session, user=outsider, query=case["query"], document_ids=ids)
                results.append({"case_index": index, "query_sha256": _digest(case["query"]),
                    "expected_document_index": expected, "returned_chunks": len(retrieved),
                    "expectation_in_source": expectation_in_source,
                    "evidence_present": evidence_present, "prompt_evidence_present": prompt_present,
                    "citation_valid": citation_valid, "outsider_denied": denied, "retrieval_ms": elapsed_ms,
                    "passed": bool(expectation_in_source and evidence_present and prompt_present and citation_valid and denied)})
            durations = sorted(item["retrieval_ms"] for item in results)
            return {"schema_version": 1, "isolated": True, "content_included": False, "generative_model_used": False,
                    "model_id": configured_model_id(), "documents": document_reports, "cases": results,
                    "corpus_sha256": _digest({"documents": [d["sha256"] for d in document_reports], "cases": cases}),
                    "case_count": len(results), "passed": sum(r["passed"] for r in results),
                    "retrieval_latency": {"sample_count": len(durations), "percentile_method": "nearest_rank",
                        "p50_ms": durations[math.ceil(len(durations) * .5) - 1], "p95_ms": durations[math.ceil(len(durations) * .95) - 1]},
                    "release_gate_passed": all(r["passed"] for r in results)}
    finally:
        engine.dispose()
        config.KNOWLEDGE_EMBEDDING_PROVIDER, ingestion.UPLOADS_DIR = previous_provider, previous_uploads


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--semantic", action="store_true")
    args = parser.parse_args()
    try:
        report = evaluate(json.loads(args.manifest.read_text()), semantic=args.semantic)
    except Exception:
        print(json.dumps({"content_included": False, "release_gate_passed": False, "error_code": "document_evaluation_failed"}))
        return 1
    print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    return int(not report["release_gate_passed"])


if __name__ == "__main__":
    raise SystemExit(main())
