from __future__ import annotations

import hashlib
import fnmatch
import json
import logging
import math
import os
from pathlib import Path
from typing import Any, Callable
import uuid

from sqlalchemy import event
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
from app.services.knowledge_permissions import KnowledgeWriteAuthorizationLost
from app.services.knowledge_templates import extract_template_fields, identify_template
from app.services.storage import StorageService
from app.services.time_utils import utc_now_naive

CHUNK_SIZE_TOKENS = 800
CHUNK_OVERLAP_TOKENS = 100
EMBEDDING_DIMENSION = 1536
SUPPORTED_SOURCE_FILE_TYPES = {"pptx", "pdf", "docx", "md", "txt", "xlsx"}

logger = logging.getLogger(__name__)

_PENDING_STORAGE_WRITES_KEY = "aria_knowledge_pending_storage_writes"


def _clear_committed_storage_writes(session: Session) -> None:
    """Forget rollback cleanup only after the database commit succeeds."""

    session.info.pop(_PENDING_STORAGE_WRITES_KEY, None)


def _discard_rolled_back_storage_writes(session: Session) -> None:
    """Compensate unique files published by a rolled-back DB transaction."""

    pending = session.info.pop(_PENDING_STORAGE_WRITES_KEY, [])
    for storage, storage_key in reversed(pending):
        _delete_storage_best_effort(storage, storage_key)


def _discard_unfinished_storage_writes(session: Session, transaction: Any) -> None:
    """Compensate when ``Session.close()`` ends an uncommitted transaction."""

    if transaction.parent is None and not transaction.nested:
        _discard_rolled_back_storage_writes(session)


def _delete_storage_best_effort(
    storage: StorageService,
    storage_key: str,
) -> None:
    try:
        storage.delete(storage_key)
    except OSError:
        # The database remains authoritative.  Keep rollback usable even if
        # an operator must later remove a filesystem orphan manually.
        logger.warning(
            "Could not remove rolled-back knowledge artifact %s",
            storage_key,
            exc_info=True,
        )


event.listen(Session, "after_commit", _clear_committed_storage_writes)
event.listen(Session, "after_rollback", _discard_rolled_back_storage_writes)
event.listen(Session, "after_transaction_end", _discard_unfinished_storage_writes)


def _register_rollback_storage_write(
    session: Session,
    storage: StorageService,
    storage_key: str,
) -> None:
    pending = session.info.setdefault(_PENDING_STORAGE_WRITES_KEY, [])
    pending.append((storage, storage_key))


def _put_rollback_guarded_bytes(
    session: Session,
    storage: StorageService,
    storage_key: str,
    content: bytes,
) -> str:
    """Publish a unique artifact and remove it if this DB unit rolls back."""

    _register_rollback_storage_write(session, storage, storage_key)
    try:
        return storage.put_bytes(storage_key, content)
    except Exception:
        session.rollback()
        raise


def _versioned_json_storage_key(
    *,
    category: str,
    document_id: int,
    stem: str,
    content: bytes,
) -> str:
    digest = sha256_bytes(content)[:16]
    return (
        f"knowledge/{category}/{document_id}/"
        f"{stem}-{digest}-{uuid.uuid4().hex}.json"
    )


def sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


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
    commit: bool = True,
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
    if commit:
        session.commit()
        session.refresh(event)
    else:
        session.flush()
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
    commit: bool = True,
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
    session.flush()
    record_document_event(
        session,
        int(doc.id),
        "document_uploaded",
        doc.status,
        message=f"Uploaded {file_name}",
        commit=False,
    )
    if commit:
        session.commit()
        session.refresh(doc)
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
    commit: bool = True,
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
    if commit:
        session.commit()
    else:
        session.flush()

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
    if commit:
        session.commit()
    else:
        session.flush()


class KnowledgeIngestionSuperseded(KnowledgeWriteAuthorizationLost):
    """Provider output no longer belongs to the frozen source/document."""


def _v1_document_source_signature(
    source: KnowledgeSource,
    document: KnowledgeV1Document,
) -> tuple[Any, ...]:
    return (
        int(source.id or 0),
        source.scope_type,
        source.scope_id,
        source.owner_user_id,
        int(document.id or 0),
        document.source_id,
        document.scope_type,
        document.scope_id,
        document.original_storage_key,
        document.path,
        document.content_hash,
        document.file_type,
        document.title,
        document.file_name,
        document.metadata_json,
    )


def index_document_actor_aware(
    session: Session,
    document_id: int,
    *,
    final_authorize: Callable[[], tuple[KnowledgeSource, KnowledgeV1Document]],
    template_key: str | None = None,
) -> tuple[KnowledgeV1Document, dict[str, Any]]:
    """Prepare provider-backed indexing, then atomically stage authorized writes.

    The caller owns the final commit together with its durable job/checkpoint.
    No document, chunk, extraction, event, or consulting-asset mutation is
    flushed before the second authorization check.
    """

    session.rollback()
    source, document = final_authorize()
    if int(document.id or 0) != int(document_id):
        session.rollback()
        raise KnowledgeIngestionSuperseded("Knowledge document changed before indexing")
    expected_source = _v1_document_source_signature(source, document)
    original_storage_key = document.original_storage_key or document.path
    expected_content_hash = document.content_hash
    file_type = document.file_type
    title = document.title
    initial_metadata = parse_json_object(document.metadata_json)
    session.rollback()

    storage = StorageService(UPLOADS_DIR)
    path = storage.resolve_path(original_storage_key)
    if _sha256_file(path) != expected_content_hash:
        raise KnowledgeIngestionSuperseded(
            "Knowledge original content does not match its committed hash"
        )
    text = extract_text_from_file(
        path,
        file_type,
        max_chars=200_000,
        empty_placeholder="",
        unsupported_placeholder="",
        error_prefix="",
    )
    if _sha256_file(path) != expected_content_hash:
        raise KnowledgeIngestionSuperseded(
            "Knowledge original changed while it was being extracted"
        )
    if not text.strip():
        raise ValueError("No text could be extracted from this document.")
    frontmatter: dict[str, Any] = {}
    if file_type == "md":
        frontmatter, text = parse_markdown_frontmatter(text)

    inferred_template, confidence = identify_template(file_type, text)
    final_template = str(template_key or initial_metadata.get("template_key") or inferred_template)
    extracted = extract_template_fields(final_template, text, title)
    metadata = dict(initial_metadata)
    metadata.update(frontmatter)
    metadata.update(infer_metadata_from_text(file_type, text, final_template))
    metadata.update(extracted)
    metadata["template_key"] = final_template
    metadata["extraction_confidence"] = confidence
    chunks = chunk_markdown_or_text(text)
    prepared_chunks = [
        (
            heading,
            content,
            estimate_tokens(content),
            serialize_embedding(deterministic_embedding(content)),
        )
        for heading, content in chunks
    ]

    # Provider/embedding work is complete. Re-open the source-family locks and
    # reject scope/content drift before staging a single durable mutation.
    session.rollback()
    source, document = final_authorize()
    if _v1_document_source_signature(source, document) != expected_source:
        session.rollback()
        raise KnowledgeIngestionSuperseded(
            "Knowledge source changed during indexing"
        )
    current_path = storage.resolve_path(
        document.original_storage_key or document.path
    )
    if current_path != path or _sha256_file(current_path) != expected_content_hash:
        session.rollback()
        raise KnowledgeIngestionSuperseded(
            "Knowledge original changed during indexing"
        )

    old_chunks = session.exec(
        select(KnowledgeChunk)
        .where(KnowledgeChunk.document_id == document_id)
        .order_by(KnowledgeChunk.id)
        .execution_options(populate_existing=True)
        .with_for_update()
    ).all()
    old_extractions = session.exec(
        select(KnowledgeTemplateExtraction)
        .where(KnowledgeTemplateExtraction.document_id == document_id)
        .order_by(KnowledgeTemplateExtraction.id)
        .execution_options(populate_existing=True)
        .with_for_update()
    ).all()
    for row in [*old_chunks, *old_extractions]:
        session.delete(row)

    extracted_payload = json.dumps(
        {"document_id": document_id, "text": text, "frontmatter": frontmatter},
        ensure_ascii=False,
    ).encode("utf-8")
    chunks_payload = json.dumps(
        [
            {
                "heading_path": heading,
                "content": content,
                "token_count": token_count,
            }
            for heading, content, token_count, _ in prepared_chunks
        ],
        ensure_ascii=False,
    ).encode("utf-8")
    # The document continues pointing at its prior immutable artifacts until
    # the caller's final authorization/job transaction commits.  A rollback
    # removes only these unique versions, so DB=A/disk=A is preserved on any
    # flush or commit failure.  Prior committed versions are intentionally
    # retained because a concurrent reader may already hold their DB key.
    extracted_key = _versioned_json_storage_key(
        category="extracted",
        document_id=document_id,
        stem="text",
        content=extracted_payload,
    )
    chunks_key = _versioned_json_storage_key(
        category="chunks",
        document_id=document_id,
        stem="chunks",
        content=chunks_payload,
    )
    _put_rollback_guarded_bytes(
        session,
        storage,
        extracted_key,
        extracted_payload,
    )
    _put_rollback_guarded_bytes(
        session,
        storage,
        chunks_key,
        chunks_payload,
    )

    try:
        _materialize_consulting_assets(
            session,
            doc=document,
            source=source,
            template_key=final_template,
            extracted=extracted,
            metadata=metadata,
            commit=False,
        )
    except Exception:
        session.rollback()
        raise
    session.add(
        KnowledgeTemplateExtraction(
            document_id=document_id,
            template_key=final_template,
            status="completed",
            extracted_json=json.dumps(extracted, ensure_ascii=False),
            confidence=confidence,
        )
    )
    for index, (heading, content, token_count, embedding) in enumerate(prepared_chunks):
        session.add(
            KnowledgeChunk(
                document_id=document_id,
                chunk_index=index,
                heading_path=json.dumps(heading, ensure_ascii=False),
                content=content,
                token_count=token_count,
                embedding_model=EMBEDDING_MODEL,
                embedding=embedding,
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

    now = utc_now_naive()
    document.metadata_json = json.dumps(metadata, ensure_ascii=False)
    document.extracted_text_storage_key = extracted_key
    document.chunks_storage_key = chunks_key
    document.token_count = estimate_tokens(text)
    document.page_count = text.count("[Page ") or 0
    document.slide_count = text.count("[Slide ") or 0
    document.chunk_count = len(prepared_chunks)
    document.status = "indexed"
    document.error_message = None
    document.updated_at = now
    session.add(document)
    session.add(
        KnowledgeDocumentEvent(
            document_id=document_id,
            event_type="index_completed",
            status="indexed",
            message=f"Indexed {len(prepared_chunks)} chunks",
            metadata_json=json.dumps(
                {"template_key": final_template},
                ensure_ascii=False,
            ),
        )
    )
    return document, {
        "template_key": final_template,
        "chunk_count": len(prepared_chunks),
        "token_count": document.token_count,
    }


def index_document(
    session: Session,
    document_id: int,
    *,
    template_key: str | None = None,
    resume_checkpoint: dict[str, Any] | None = None,
    checkpoint: Callable[[str, dict[str, Any]], None] | None = None,
) -> KnowledgeV1Document:
    doc = session.get(KnowledgeV1Document, document_id)
    if not doc:
        raise ValueError(f"Knowledge document not found: {document_id}")

    storage = StorageService(UPLOADS_DIR)
    path = storage.resolve_path(doc.original_storage_key or doc.path)
    resume_value = dict(resume_checkpoint or {})
    resume_phase = str(
        resume_value.get("document_phase") or resume_value.get("phase") or ""
    )
    phase_order = {
        "": 0,
        "queued": 0,
        "extracting": 1,
        "extracted": 2,
        "understood": 3,
        "chunks_ready": 4,
        "embedding": 5,
        "indexed": 6,
        "completed": 7,
    }

    def phase_reached(phase: str) -> bool:
        return phase_order.get(resume_phase, 0) >= phase_order[phase]

    def emit_checkpoint(phase: str, **facts: Any) -> None:
        if checkpoint:
            checkpoint(phase, facts)

    if doc.status == "indexed" and phase_reached("indexed"):
        return doc

    text = ""
    frontmatter: dict[str, Any] = {}
    if phase_reached("extracted") and doc.extracted_text_storage_key:
        try:
            cached = json.loads(storage.read_text(doc.extracted_text_storage_key))
            if isinstance(cached, dict) and cached.get("document_id") == doc.id:
                text = str(cached.get("text") or "")
                raw_frontmatter = cached.get("frontmatter")
                if isinstance(raw_frontmatter, dict):
                    frontmatter = raw_frontmatter
        except (FileNotFoundError, json.JSONDecodeError, ValueError):
            text = ""

    if not text.strip():
        doc.error_message = None
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

        if doc.file_type == "md":
            frontmatter, text = parse_markdown_frontmatter(text)
        extracted_key = f"knowledge/extracted/{doc.id}/text.json"
        storage.put_text(
            extracted_key,
            json.dumps(
                {"document_id": doc.id, "text": text, "frontmatter": frontmatter},
                ensure_ascii=False,
            ),
        )
        doc.extracted_text_storage_key = extracted_key
        doc.token_count = estimate_tokens(text)
        doc.page_count = text.count("[Page ") or 0
        doc.slide_count = text.count("[Slide ") or 0
        _set_status(
            session,
            doc,
            "extracted",
            "extract_completed",
            message=f"Extracted {len(text)} characters",
        )
        emit_checkpoint("extracted", token_count=doc.token_count)

    metadata = parse_json_object(doc.metadata_json)
    final_template = str(template_key or metadata.get("template_key") or "")
    if not phase_reached("understood") or not final_template:
        _set_status(session, doc, "understanding", "understand_started")
        inferred_template, confidence = identify_template(doc.file_type, text)
        final_template = template_key or inferred_template
        extracted = extract_template_fields(final_template, text, doc.title)
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
        old_extractions = session.exec(
            select(KnowledgeTemplateExtraction).where(
                KnowledgeTemplateExtraction.document_id == doc.id
            )
        ).all()
        for old_extraction in old_extractions:
            session.delete(old_extraction)
        session.add(
            KnowledgeTemplateExtraction(
                document_id=doc.id,
                template_key=final_template,
                status="completed",
                extracted_json=json.dumps(extracted, ensure_ascii=False),
                confidence=confidence,
            )
        )
        session.add(doc)
        session.commit()
        record_document_event(
            session,
            doc.id,
            "understand_completed",
            "understanding",
            message=f"Template: {final_template}",
        )
        emit_checkpoint("understood", template_key=final_template)

    chunks: list[tuple[list[str], str]] = []
    if phase_reached("chunks_ready") and doc.chunks_storage_key:
        try:
            cached_chunks = json.loads(storage.read_text(doc.chunks_storage_key))
            if isinstance(cached_chunks, list):
                for item in cached_chunks:
                    if not isinstance(item, dict) or not str(item.get("content") or "").strip():
                        continue
                    raw_heading = item.get("heading_path")
                    heading = [str(value) for value in raw_heading] if isinstance(raw_heading, list) else []
                    chunks.append((heading, str(item["content"])))
        except (FileNotFoundError, json.JSONDecodeError, ValueError):
            chunks = []

    if not chunks:
        _set_status(session, doc, "chunking", "chunk_started")
        chunks = chunk_markdown_or_text(text)
        chunks_key = f"knowledge/chunks/{doc.id}/chunks.json"
        storage.put_text(
            chunks_key,
            json.dumps(
                [
                    {
                        "heading_path": heading,
                        "content": content,
                        "token_count": estimate_tokens(content),
                    }
                    for heading, content in chunks
                ],
                ensure_ascii=False,
            ),
        )
        doc.chunks_storage_key = chunks_key
        doc.chunk_count = len(chunks)
        session.add(doc)
        session.commit()
        emit_checkpoint(
            "chunks_ready",
            template_key=final_template,
            chunk_count=len(chunks),
        )

    old_chunks = session.exec(
        select(KnowledgeChunk).where(KnowledgeChunk.document_id == doc.id)
    ).all()
    for old_chunk in old_chunks:
        session.delete(old_chunk)
    session.commit()

    _set_status(
        session,
        doc,
        "embedding",
        "embedding_started",
        message=f"Embedding {len(chunks)} chunks",
    )
    emit_checkpoint("embedding", template_key=final_template, chunk_count=len(chunks))
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
    emit_checkpoint("indexed", template_key=final_template, chunk_count=len(chunks))
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


def scan_source_files(
    session: Session,
    source_id: int,
    *,
    final_authorize: Callable[[], KnowledgeSource] | None = None,
) -> list[KnowledgeV1Document]:
    source = final_authorize() if final_authorize is not None else session.get(KnowledgeSource, source_id)
    if not source:
        raise ValueError(f"Knowledge source not found: {source_id}")
    expected_source = (
        int(source.id or 0),
        source.scope_type,
        source.scope_id,
        source.owner_user_id,
        source.source_type,
        source.config_json,
        source.include_patterns,
        source.exclude_patterns,
    )
    config = parse_json_object(source.config_json)
    root_value = str(config.get("root_path") or "").strip()
    if source.source_type not in {"markdown_folder", "obsidian_vault", "git_repo"} or not root_value:
        return []
    root = Path(root_value).expanduser().resolve()
    if not root.is_dir():
        if final_authorize is not None:
            session.rollback()
            source = final_authorize()
            if (
                int(source.id or 0),
                source.scope_type,
                source.scope_id,
                source.owner_user_id,
                source.source_type,
                source.config_json,
                source.include_patterns,
                source.exclude_patterns,
            ) != expected_source:
                session.rollback()
                raise KnowledgeIngestionSuperseded(
                    "Knowledge source changed during scan"
                )
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
        # A scan attempt owns a unique original key.  This makes compensation
        # safe even when two workers discover identical content concurrently:
        # one failed transaction can never delete the other's committed file.
        storage_key = (
            f"knowledge/originals/source-{source.id}/"
            f"{content_hash}-{uuid.uuid4().hex}.{file_type}"
        )
        if final_authorize is not None:
            session.rollback()
            source = final_authorize()
            if (
                int(source.id or 0),
                source.scope_type,
                source.scope_id,
                source.owner_user_id,
                source.source_type,
                source.config_json,
                source.include_patterns,
                source.exclude_patterns,
            ) != expected_source:
                session.rollback()
                raise KnowledgeIngestionSuperseded(
                    "Knowledge source changed during scan"
                )
        storage = StorageService(UPLOADS_DIR)
        storage.put_bytes(storage_key, content)
        if final_authorize is not None:
            session.rollback()
            try:
                source = final_authorize()
            except Exception:
                _delete_storage_best_effort(storage, storage_key)
                raise
            if (
                int(source.id or 0),
                source.scope_type,
                source.scope_id,
                source.owner_user_id,
                source.source_type,
                source.config_json,
                source.include_patterns,
                source.exclude_patterns,
            ) != expected_source:
                session.rollback()
                _delete_storage_best_effort(storage, storage_key)
                raise KnowledgeIngestionSuperseded(
                    "Knowledge source changed during scan"
                )
        _register_rollback_storage_write(session, storage, storage_key)
        try:
            document = create_document_from_bytes(
                session=session,
                source=source,
                file_name=path.name,
                content=content,
                relative_path=storage_key,
                source_metadata={"source_relative_path": path.relative_to(root).as_posix()},
                commit=False,
            )
            staged_original_is_referenced = (
                document.original_storage_key == storage_key
            )
            session.commit()
        except Exception:
            session.rollback()
            raise
        if not staged_original_is_referenced:
            # Deduplication returned a previously committed document.  Its
            # original remains authoritative, so this unique scan copy is not
            # needed after the successful DB transaction.
            _delete_storage_best_effort(storage, storage_key)
        session.refresh(document)
        documents.append(document)
    return documents
