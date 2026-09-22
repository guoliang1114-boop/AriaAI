import json

import pytest

from app import config
from app.services import knowledge_ingestion
from scripts.knowledge_document_eval import evaluate
from tests.knowledge_document_fixtures import document_bytes


def test_document_evaluation_checks_real_pipeline_and_emits_no_source_content(tmp_path):
    content, markers = document_bytes("docx")
    path = tmp_path / "private-filename.docx"
    path.write_bytes(content)
    provider, uploads = config.KNOWLEDGE_EMBEDDING_PROVIDER, knowledge_ingestion.UPLOADS_DIR
    manifest = {"documents": [{"path": str(path)}], "cases": [
        {"query": markers[0], "document_index": 0, "phrases": [markers[0]]},
        {"query": "xylophonicquasar", "document_index": None, "phrases": []},
        {"query": markers[0], "document_index": 0, "phrases": ["missing_expected_fact"]},
    ]}
    report = evaluate(manifest)
    assert report["passed"] == 2 and not report["release_gate_passed"]
    assert all(row["outsider_denied"] for row in report["cases"])
    assert report["cases"][0]["citation_valid"] and report["cases"][0]["prompt_evidence_present"]
    assert report["cases"][0]["expectation_in_source"]
    assert not report["cases"][2]["expectation_in_source"]
    assert all(private not in json.dumps(report) for private in [str(path), *markers, "missing_expected_fact", "xylophonicquasar"])
    assert config.KNOWLEDGE_EMBEDDING_PROVIDER == provider and knowledge_ingestion.UPLOADS_DIR == uploads


def test_failed_extraction_restores_global_configuration(tmp_path):
    path = tmp_path / "corrupt.pptx"
    path.write_bytes(b"invalid document")
    provider, uploads = config.KNOWLEDGE_EMBEDDING_PROVIDER, knowledge_ingestion.UPLOADS_DIR
    with pytest.raises(ValueError):
        evaluate({"documents": [{"path": str(path)}], "cases": [{"query": "q", "document_index": 0, "phrases": ["q"]}]})
    assert config.KNOWLEDGE_EMBEDDING_PROVIDER == provider and knowledge_ingestion.UPLOADS_DIR == uploads


@pytest.mark.parametrize("index,phrases", [(0, []), (None, ["unexpected"]), (True, ["q"]), (1, ["q"])])
def test_invalid_expectations_cannot_produce_a_passing_report(index, phrases):
    with pytest.raises(ValueError):
        evaluate({"documents": [{"path": "unused"}], "cases": [{"query": "q", "document_index": index, "phrases": phrases}]})
