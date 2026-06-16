from __future__ import annotations

import hashlib
import fnmatch
import json
import math
import os
from pathlib import Path
from typing import Any

from sqlmodel import Session, select

from app.config import EMBEDDING_MODEL, UPLOADS_DIR
from app.models.knowledge import (
    KnowledgeCase,
    KnowledgeChunk,
    KnowledgeDocumentEvent,
    KnowledgeMethod,
    KnowledgeSource,
    KnowledgeTemplateExtraction,
    KnowledgeV1Document,
)
from app.services.document_text import extract_text_from_file
from app.services.knowledge_templates import extract_template_fields, identify_template
from app.services.storage import StorageService
from app.services.time_utils import utc_now_naive

CHUNK_SIZE_TOKENS = 800
CHUNK_OVERLAP_TOKENS = 100
EMBEDDING_DIMENSION = 1536
SUPPORTED_SOURCE_FILE_TYPES = {"pptx", "pdf", "docx", "md", "txt", "xlsx"}


def sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def normalize_file_type(file_name: str) -> str:
    suffix = Path(file_name or "").suffix.lower().lstrip(".")
    aliases = {"ppt": "pptx", "doc": "docx", "markdown": "md"}
    return aliases.get(suffix, suffix or "txt")


def parse_json_object(raw: str, default: dict[str, Any] | None = None) -> dict[str, Any]:
    try:
        value = json.loads(raw or "{}")
    except json.JSONDecodeError:
        return default or {}
    return value if isinstance(value, dict) else (default or {})


def record_document_event(
    session: Session,
    document_id: int,
    event_type: str,
    status: str,
    *,
    message: str = "",
    duration_ms: int = 0,
    metadata: dict[str, Any] | None = None,
) -> KnowledgeDocumentEvent:
    event = KnowledgeDocumentEvent(
        document_id=document_id,
        event_type=event_type,
        status=status,
        message=message,
        duration_ms=duration_ms,
        metadata_json=json.dumps(metadata or {}, ensure_ascii=False),
    )
    session.add(event)
    session.commit()
    session.refresh(event)
    return event


def estimate_tokens(text: str) -> int:
    if not text:
        return 0
    # Mixed Chinese/English rough estimate good enough for chunk bounds.
    return max(1, math.ceil(len(text) / 4))


def _split_long_text(text: str, max_chars: int, overlap_chars: int) -> list[str]:
    chunks: list[str] = []
    start = 0
    while start < len(text):
        chunk = text[start : start + max_chars].strip()
        if chunk:
            chunks.append(chunk)
        start += max(1, max_chars - overlap_chars)
    return chunks


def chunk_markdown_or_text(text: str) -> list[tuple[list[str], str]]:
    max_chars = CHUNK_SIZE_TOKENS * 4
    overlap_chars = CHUNK_OVERLAP_TOKENS * 4
    sections: list[tuple[list[str], list[str]]] = []
    current_heading: list[str] = []
    current_lines: list[str] = []

    for line in (text or "").splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            hashes = len(stripped) - len(stripped.lstrip("#"))
            if 1 <= hashes <= 3:
                if current_lines:
                    sections.append((current_heading[:], current_lines))
                    current_lines = []
                title = stripped.lstrip("#").strip()
                current_heading = current_heading[: hashes - 1] + [title]
                continue
        current_lines.append(line)
    if current_lines:
        sections.append((current_heading[:], current_lines))

    if not sections and text.strip():
        sections = [([], [text])]

    chunks: list[tuple[list[str], str]] = []
    for heading, lines in sections:
        body = "\n".join(lines).strip()
        if not body:
            continue
        if len(body) <= max_chars:
            chunks.append((heading, body))
            continue
        chunks.extend((heading, part) for part in _split_long_text(body, max_chars, overlap_chars))
    return chunks


def parse_markdown_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    if not text.startswith("---"):
        return {}, text
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, text
    metadata: dict[str, Any] = {}
    end_index = None
    for index, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            end_index = index
            break
        if ":" not in line:
            continue
        key, raw_value = line.split(":", 1)
        key = key.strip()
        value = raw_value.strip()
        if not key:
            continue
        if value.startswith("[") and value.endswith("]"):
            metadata[key] = [item.strip().strip("'\"") for item in value[1:-1].split(",") if item.strip()]
        else:
            metadata[key] = value.strip("'\"")
    if end_index is None:
        return {}, text
    return metadata, "\n".join(lines[end_index + 1 :]).strip()


def infer_metadata_from_text(file_type: str, text: str, template_key: str) -> dict[str, Any]:
    lowered = text.lower()
    industries = []
    for label in ("文旅", "商旅", "零售", "制造", "金融", "地产", "医疗", "教育"):
        if label in text:
            industries.append(label)
    service_lines = []
    for label in ("数字化战略", "会员运营", "数据中台", "财务", "内控", "组织", "营销"):
        if label in text:
            service_lines.append(label)
    project_types = []
    for label in ("会员体系", "数据中台", "战略规划", "流程优化", "SOW", "提案"):
        if label.lower() in lowered or label in text:
            project_types.append(label)
    document_type = {
        "consulting_case": "case_ppt" if file_type == "pptx" else "case_document",
        "methodology": "methodology",
        "deliverable_template": "template",
    }.get(template_key, "general_document")
    confidential_level = "client_sensitive" if any(term in text for term in ("客户", "合同", "金额", "报价")) else "public_internal"
    return {
        "document_type": document_type,
        "industries": industries,
        "service_lines": service_lines,
        "project_types": project_types,
        "deliverable_types": [],
        "client_stage": "unknown",
        "confidential_level": confidential_level,
        "reuse_policy": "reference_only",
        "quality_score": 0.65 if text.strip() else 0.0,
    }


def deterministic_embedding(text: str, dimensions: int = EMBEDDING_DIMENSION) -> list[float]:
    """Deterministic local embedding placeholder for v1 indexing tests.

    Production can swap this for OpenAI embeddings behind the same interface.
    Keeping it deterministic avoids flaky tests and lets indexing run offline.
    """
    vector = [0.0] * dimensions
    tokens = [token for token in (text or "").lower().split() if token]
    if not tokens:
        tokens = [text[:64] or "empty"]
    for token in tokens:
        digest = hashlib.sha256(token.encode("utf-8", errors="ignore")).digest()
        index = int.from_bytes(digest[:4], "big") % dimensions
        vector[index] += 1.0
    norm = math.sqrt(sum(value * value for value in vector)) or 1.0
    return [round(value / norm, 8) for value in vector]


def serialize_embedding(vector: list[float]):
    # Production pgvector accepts a list; local/test Postgres instances in this
    # repo may not have the extension installed, so the model can fall back to
    # Text unless ARIA_ENABLE_PGVECTOR is explicitly enabled.
    if os.getenv("ARIA_ENABLE_PGVECTOR", "").lower() in {"1", "true", "yes"}:
        return vector
    return json.dumps(vector)


def parse_embedding(value) -> list[float]:
    if value is None:
        return []
    if isinstance(value, list):
        return [float(item) for item in value]
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return []
        return [float(item) for item in parsed] if isinstance(parsed, list) else []
    try:
        return [float(item) for item in value]
    except TypeError:
        return []


def create_document_from_bytes(
    *,
    session: Session,
    source: KnowledgeSource,
    file_name: str,
    content: bytes,
    relative_path: str,
    template_key: str | None = None,
    source_metadata: dict[str, Any] | None = None,
) -> KnowledgeV1Document:
    content_hash = sha256_bytes(content)
    existing = session.exec(
        select(KnowledgeV1Document).where(
            KnowledgeV1Document.source_id == source.id,
            KnowledgeV1Document.content_hash == content_hash,
            KnowledgeV1Document.status != "deleted",
        )
    ).first()
    if existing:
        return existing

    file_type = normalize_file_type(file_name)
    metadata = dict(source_metadata or {})
    if template_key:
        metadata["template_key"] = template_key
    doc = KnowledgeV1Document(
        source_id=source.id,
        title=Path(file_name).stem or file_name,
        file_name=file_name,
        file_type=file_type,
        path=relative_path,
        original_storage_key=relative_path,
        content_hash=content_hash,
        file_size_bytes=len(content),
        metadata_json=json.dumps(metadata, ensure_ascii=False),
        scope_type=source.scope_type,
        scope_id=source.scope_id,
        status="uploaded",
    )
    session.add(doc)
    session.commit()
    session.refresh(doc)
    record_document_event(session, doc.id, "document_uploaded", doc.status, message=f"Uploaded {file_name}")
    return doc


def _set_status(session: Session, doc: KnowledgeV1Document, status: str, event_type: str, *, message: str = "") -> None:
    doc.status = status
    doc.updated_at = utc_now_naive()
    session.add(doc)
    session.commit()
    record_document_event(session, doc.id, event_type, status, message=message)


def _json_list(value: Any) -> str:
    return json.dumps(value if isinstance(value, list) else [], ensure_ascii=False)


def _materialize_consulting_assets(
    session: Session,
    *,
    doc: KnowledgeV1Document,
    source: KnowledgeSource | None,
    template_key: str,
    extracted: dict[str, Any],
    metadata: dict[str, Any],
) -> None:
    if not source:
        return
    existing_cases = session.exec(select(KnowledgeCase).where(KnowledgeCase.source_id == source.id)).all()
    existing_methods = session.exec(select(KnowledgeMethod).where(KnowledgeMethod.source_id == source.id)).all()
    doc_id_text = str(doc.id)
    for case in existing_cases:
        if doc_id_text in (case.source_document_ids or ""):
            session.delete(case)
    for method in existing_methods:
        if doc_id_text in (method.source_document_ids or ""):
            session.delete(method)
    session.commit()

    if template_key == "consulting_case":
        session.add(
            KnowledgeCase(
                source_id=source.id,
                case_title=str(extracted.get("case_title") or doc.title),
                industry=str(extracted.get("industry") or ",".join(metadata.get("industries") or [])),
                service_line=str(extracted.get("service_line") or ",".join(metadata.get("service_lines") or [])),
                project_type=str(extracted.get("project_type") or ",".join(metadata.get("project_types") or [])),
                client_stage=str(extracted.get("client_stage") or metadata.get("client_stage") or "unknown"),
                business_problem=str(extracted.get("business_problem") or ""),
                solution_summary=str(extracted.get("solution_summary") or ""),
                deliverables=_json_list(extracted.get("deliverables")),
                methods_used=_json_list(extracted.get("methods_used")),
                key_risks=_json_list(extracted.get("key_risks")),
                lessons_learned=_json_list(extracted.get("lessons_learned")),
                reusable_assets=_json_list(extracted.get("reusable_assets")),
                source_document_ids=json.dumps([doc.id]),
                confidential_level=str(metadata.get("confidential_level") or "public_internal"),
                scope_type=doc.scope_type,
                scope_id=doc.scope_id,
                owner_user_id=source.owner_user_id,
            )
        )
    elif template_key == "methodology":
        session.add(
            KnowledgeMethod(
                source_id=source.id,
                method_title=str(extracted.get("method_title") or doc.title),
                method_type=str(extracted.get("method_type") or "framework"),
                industry=",".join(metadata.get("industries") or []),
                service_line=str(extracted.get("service_line") or ",".join(metadata.get("service_lines") or [])),
                description=str(extracted.get("description") or metadata.get("summary") or ""),
                applicable_stages=_json_list(extracted.get("applicable_stages")),
                key_components=_json_list(extracted.get("key_components")),
                source_document_ids=json.dumps([doc.id]),
                confidential_level=str(metadata.get("confidential_level") or "public_internal"),
                scope_type=doc.scope_type,
                scope_id=doc.scope_id,
                owner_user_id=source.owner_user_id,
            )
        )
    session.commit()


def index_document(session: Session, document_id: int, *, template_key: str | None = None) -> KnowledgeV1Document:
    doc = session.get(KnowledgeV1Document, document_id)
    if not doc:
        raise ValueError(f"Knowledge document not found: {document_id}")

    storage = StorageService(UPLOADS_DIR)
    path = storage.resolve_path(doc.original_storage_key or doc.path)
    _set_status(session, doc, "extracting", "extract_started")

    text = extract_text_from_file(
        path,
        doc.file_type,
        max_chars=200_000,
        empty_placeholder="",
        unsupported_placeholder="",
        error_prefix="",
    )
    if not text.strip():
        doc.status = "failed_extract"
        doc.error_message = "No text could be extracted from this document."
        doc.updated_at = utc_now_naive()
        session.add(doc)
        session.commit()
        record_document_event(session, doc.id, "extract_failed", doc.status, message=doc.error_message)
        return doc

    frontmatter = {}
    if doc.file_type == "md":
        frontmatter, text = parse_markdown_frontmatter(text)
    extracted_key = f"knowledge/extracted/{doc.id}/text.json"
    storage.put_text(
        extracted_key,
        json.dumps({"document_id": doc.id, "text": text, "frontmatter": frontmatter}, ensure_ascii=False),
    )
    doc.extracted_text_storage_key = extracted_key
    doc.token_count = estimate_tokens(text)
    doc.page_count = text.count("[Page ") or 0
    doc.slide_count = text.count("[Slide ") or 0
    _set_status(session, doc, "extracted", "extract_completed", message=f"Extracted {len(text)} characters")
    _set_status(session, doc, "understanding", "understand_started")
    inferred_template, confidence = identify_template(doc.file_type, text)
    final_template = template_key or inferred_template
    extracted = extract_template_fields(final_template, text, doc.title)
    metadata = parse_json_object(doc.metadata_json)
    metadata.update(frontmatter)
    metadata.update(infer_metadata_from_text(doc.file_type, text, final_template))
    metadata.update(extracted)
    metadata["template_key"] = final_template
    metadata["extraction_confidence"] = confidence
    doc.metadata_json = json.dumps(metadata, ensure_ascii=False)
    source = session.get(KnowledgeSource, doc.source_id)
    _materialize_consulting_assets(
        session,
        doc=doc,
        source=source,
        template_key=final_template,
        extracted=extracted,
        metadata=metadata,
    )
    extraction = KnowledgeTemplateExtraction(
        document_id=doc.id,
        template_key=final_template,
        status="completed",
        extracted_json=json.dumps(extracted, ensure_ascii=False),
        confidence=confidence,
    )
    session.add(extraction)
    session.add(doc)
    session.commit()
    record_document_event(session, doc.id, "understand_completed", "understanding", message=f"Template: {final_template}")

    old_chunks = session.exec(select(KnowledgeChunk).where(KnowledgeChunk.document_id == doc.id)).all()
    for chunk in old_chunks:
        session.delete(chunk)
    session.commit()

    _set_status(session, doc, "chunking", "chunk_started")
    chunks = chunk_markdown_or_text(text)
    chunks_key = f"knowledge/chunks/{doc.id}/chunks.json"
    storage.put_text(
        chunks_key,
        json.dumps(
            [
                {"heading_path": heading, "content": content, "token_count": estimate_tokens(content)}
                for heading, content in chunks
            ],
            ensure_ascii=False,
        ),
    )
    doc.chunks_storage_key = chunks_key
    doc.chunk_count = len(chunks)

    _set_status(session, doc, "embedding", "embedding_started", message=f"Embedding {len(chunks)} chunks")
    for index, (heading, content) in enumerate(chunks):
        session.add(
            KnowledgeChunk(
                document_id=doc.id,
                chunk_index=index,
                heading_path=json.dumps(heading, ensure_ascii=False),
                content=content,
                token_count=estimate_tokens(content),
                embedding_model=EMBEDDING_MODEL,
                embedding=serialize_embedding(deterministic_embedding(content)),
                metadata_json=json.dumps(
                    {
                        "template_key": final_template,
                        "confidential_level": metadata.get("confidential_level"),
                        "reuse_policy": metadata.get("reuse_policy"),
                        "industries": metadata.get("industries") or [],
                        "service_lines": metadata.get("service_lines") or [],
                    },
                    ensure_ascii=False,
                ),
            )
        )
    doc.status = "indexed"
    doc.error_message = None
    doc.updated_at = utc_now_naive()
    session.add(doc)
    session.commit()
    record_document_event(session, doc.id, "index_completed", doc.status, message=f"Indexed {len(chunks)} chunks")
    session.refresh(doc)
    return doc


def _matches_any(path: Path, root: Path, patterns: list[str]) -> bool:
    rel = path.relative_to(root).as_posix()
    for raw_pattern in patterns:
        pattern = raw_pattern.strip()
        if not pattern:
            continue
        if fnmatch.fnmatch(rel, pattern):
            return True
        if pattern.startswith("**/") and fnmatch.fnmatch(rel, pattern[3:]):
            return True
    return False


def scan_source_files(session: Session, source_id: int) -> list[KnowledgeV1Document]:
    source = session.get(KnowledgeSource, source_id)
    if not source:
        raise ValueError(f"Knowledge source not found: {source_id}")
    config = parse_json_object(source.config_json)
    root_value = str(config.get("root_path") or "").strip()
    if source.source_type not in {"markdown_folder", "obsidian_vault", "git_repo"} or not root_value:
        return []
    root = Path(root_value).expanduser().resolve()
    if not root.is_dir():
        source.status = "error"
        source.updated_at = utc_now_naive()
        session.add(source)
        session.commit()
        return []

    include_patterns = [item.strip() for item in (source.include_patterns or "").split(",") if item.strip()]
    exclude_patterns = [item.strip() for item in (source.exclude_patterns or "").split(",") if item.strip()]
    documents: list[KnowledgeV1Document] = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        file_type = normalize_file_type(path.name)
        if file_type not in SUPPORTED_SOURCE_FILE_TYPES:
            continue
        if include_patterns and not _matches_any(path, root, include_patterns):
            continue
        if exclude_patterns and _matches_any(path, root, exclude_patterns):
            continue
        content = path.read_bytes()
        content_hash = sha256_bytes(content)
        storage_key = f"knowledge/originals/source-{source.id}/{content_hash}.{file_type}"
        StorageService(UPLOADS_DIR).put_bytes(storage_key, content)
        document = create_document_from_bytes(
            session=session,
            source=source,
            file_name=path.name,
            content=content,
            relative_path=storage_key,
            source_metadata={"source_relative_path": path.relative_to(root).as_posix()},
        )
        documents.append(document)
    return documents
