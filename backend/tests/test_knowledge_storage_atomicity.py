from __future__ import annotations

import os
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import pytest
from sqlmodel import Session, SQLModel, create_engine, select

from app.models.db import ClientRecord, Project, ProjectMember, User
from app.models.knowledge import (
    KnowledgeDocumentEvent,
    KnowledgeSource,
    KnowledgeV1Document,
)
from app.services import knowledge_ingestion
from app.services.knowledge_ingestion import (
    KnowledgeIngestionSuperseded,
    create_document_from_bytes,
    index_document_actor_aware,
    scan_source_files,
    sha256_bytes,
)
from app.services.knowledge_permissions import (
    lock_and_require_source_document_write,
)
from app.services.storage import StorageService


def _engine(database_path: Path):
    engine = create_engine(
        f"sqlite:///{database_path}",
        connect_args={"check_same_thread": False},
    )
    SQLModel.metadata.create_all(engine)
    return engine


def _indexed_document(
    session: Session,
    storage_root: Path,
) -> tuple[int, int, int, str]:
    actor = User(
        email="knowledge-storage-actor@example.com",
        password_hash="x",
        is_active=True,
    )
    session.add(actor)
    session.flush()
    client = ClientRecord(name="Knowledge storage client")
    session.add(client)
    session.flush()
    project = Project(
        name="Knowledge storage project",
        client=client.name,
        client_id=int(client.id),
    )
    session.add(project)
    session.flush()
    session.add(
        ProjectMember(
            project_id=int(project.id),
            user_id=int(actor.id),
            role="owner",
        )
    )
    source = KnowledgeSource(
        name="Knowledge storage source",
        source_type="manual_upload",
        scope_type="project",
        scope_id=int(project.id),
        owner_user_id=int(actor.id),
    )
    session.add(source)
    session.commit()
    session.refresh(source)

    content = b"# Version A\nCommitted knowledge artifact A."
    original_key = (
        f"knowledge/originals/source-{source.id}/{sha256_bytes(content)}.md"
    )
    StorageService(storage_root).put_bytes(original_key, content)
    document = create_document_from_bytes(
        session=session,
        source=source,
        file_name="versioned.md",
        content=content,
        relative_path=original_key,
    )
    actor_id = int(actor.id)
    source_id = int(source.id)
    document_id = int(document.id)

    def final_authorize():
        current_actor = session.get(User, actor_id)
        assert current_actor is not None
        locked_source, locked_document, _ = lock_and_require_source_document_write(
            session,
            source_id,
            document_id,
            current_actor,
        )
        return locked_source, locked_document

    indexed, _ = index_document_actor_aware(
        session,
        document_id,
        final_authorize=final_authorize,
    )
    session.commit()
    session.refresh(indexed)
    return actor_id, source_id, document_id, original_key


def _final_authorizer(
    session: Session,
    *,
    actor_id: int,
    source_id: int,
    document_id: int,
):
    def authorize():
        actor = session.get(User, actor_id)
        assert actor is not None
        source, document, _ = lock_and_require_source_document_write(
            session,
            source_id,
            document_id,
            actor,
        )
        return source, document

    return authorize


def _commit_new_original(
    session: Session,
    storage_root: Path,
    *,
    source_id: int,
    document_id: int,
    content: bytes,
) -> str:
    content_hash = sha256_bytes(content)
    storage_key = (
        f"knowledge/originals/source-{source_id}/{content_hash}.md"
    )
    StorageService(storage_root).put_bytes(storage_key, content)
    document = session.get(KnowledgeV1Document, document_id)
    assert document is not None
    document.original_storage_key = storage_key
    document.path = storage_key
    document.content_hash = content_hash
    document.file_size_bytes = len(content)
    document.status = "queued"
    session.add(document)
    session.commit()
    return storage_key


def _artifact_files(root: Path, document_id: int) -> set[Path]:
    files: set[Path] = set()
    for category in ("extracted", "chunks"):
        directory = root / "knowledge" / category / str(document_id)
        if directory.exists():
            files.update(path for path in directory.iterdir() if path.is_file())
    return files


def test_actor_reindex_rejects_original_that_does_not_match_committed_hash() -> None:
    with TemporaryDirectory() as temp_dir:
        root = Path(temp_dir)
        storage_root = root / "uploads"
        engine = _engine(root / "aria.db")
        with patch.object(knowledge_ingestion, "UPLOADS_DIR", storage_root):
            with Session(engine) as session:
                actor_id, source_id, document_id, original_key = _indexed_document(
                    session,
                    storage_root,
                )
                storage = StorageService(storage_root)
                old_files = _artifact_files(storage_root, document_id)
                storage.put_bytes(original_key, b"tampered without a DB hash update")

                with patch.object(
                    knowledge_ingestion,
                    "deterministic_embedding",
                    side_effect=AssertionError("hash mismatch reached embedding"),
                ):
                    with pytest.raises(
                        KnowledgeIngestionSuperseded,
                        match="committed hash",
                    ):
                        index_document_actor_aware(
                            session,
                            document_id,
                            final_authorize=_final_authorizer(
                                session,
                                actor_id=actor_id,
                                source_id=source_id,
                                document_id=document_id,
                            ),
                        )

                assert _artifact_files(storage_root, document_id) == old_files
        engine.dispose()


def test_actor_reindex_rechecks_original_after_embedding_work() -> None:
    with TemporaryDirectory() as temp_dir:
        root = Path(temp_dir)
        storage_root = root / "uploads"
        engine = _engine(root / "aria.db")
        with patch.object(knowledge_ingestion, "UPLOADS_DIR", storage_root):
            with Session(engine) as session:
                actor_id, source_id, document_id, original_key = _indexed_document(
                    session,
                    storage_root,
                )
                storage = StorageService(storage_root)
                old_files = _artifact_files(storage_root, document_id)
                original_embedding = knowledge_ingestion.deterministic_embedding

                def mutate_original_after_extract(text: str, dimensions: int = 1536):
                    storage.put_bytes(
                        original_key,
                        b"tampered while embedding work was in progress",
                    )
                    return original_embedding(text, dimensions)

                with patch.object(
                    knowledge_ingestion,
                    "deterministic_embedding",
                    side_effect=mutate_original_after_extract,
                ):
                    with pytest.raises(
                        KnowledgeIngestionSuperseded,
                        match="changed during indexing",
                    ):
                        index_document_actor_aware(
                            session,
                            document_id,
                            final_authorize=_final_authorizer(
                                session,
                                actor_id=actor_id,
                                source_id=source_id,
                                document_id=document_id,
                            ),
                        )

                assert _artifact_files(storage_root, document_id) == old_files
        engine.dispose()


def test_actor_reindex_commit_failure_restores_db_and_removes_new_versions() -> None:
    with TemporaryDirectory() as temp_dir:
        root = Path(temp_dir)
        storage_root = root / "uploads"
        engine = _engine(root / "aria.db")
        with patch.object(knowledge_ingestion, "UPLOADS_DIR", storage_root):
            with Session(engine) as session:
                actor_id, source_id, document_id, original_key = _indexed_document(
                    session,
                    storage_root,
                )
                storage = StorageService(storage_root)
                before = session.get(KnowledgeV1Document, document_id)
                assert before is not None
                old_extracted_key = before.extracted_text_storage_key
                old_chunks_key = before.chunks_storage_key
                old_extracted = storage.read_bytes(old_extracted_key)
                old_chunks = storage.read_bytes(old_chunks_key)
                old_files = _artifact_files(storage_root, document_id)

                new_original_key = _commit_new_original(
                    session,
                    storage_root,
                    source_id=source_id,
                    document_id=document_id,
                    content=b"# Version B\nThis reindex must not survive DB commit failure.",
                )
                indexed, _ = index_document_actor_aware(
                    session,
                    document_id,
                    final_authorize=_final_authorizer(
                        session,
                        actor_id=actor_id,
                        source_id=source_id,
                        document_id=document_id,
                    ),
                )
                assert indexed.extracted_text_storage_key != old_extracted_key
                assert indexed.chunks_storage_key != old_chunks_key

                with patch.object(
                    session,
                    "commit",
                    side_effect=RuntimeError("forced DB commit failure"),
                ):
                    with pytest.raises(RuntimeError, match="forced DB commit failure"):
                        session.commit()
                session.rollback()
                session.expire_all()

                current = session.get(KnowledgeV1Document, document_id)
                assert current is not None
                assert current.original_storage_key == new_original_key
                assert current.content_hash in new_original_key
                assert current.extracted_text_storage_key == old_extracted_key
                assert current.chunks_storage_key == old_chunks_key
                assert storage.read_bytes(old_extracted_key) == old_extracted
                assert storage.read_bytes(old_chunks_key) == old_chunks
                assert _artifact_files(storage_root, document_id) == old_files
        engine.dispose()


def test_actor_reindex_flush_failure_removes_new_versions() -> None:
    with TemporaryDirectory() as temp_dir:
        root = Path(temp_dir)
        storage_root = root / "uploads"
        engine = _engine(root / "aria.db")
        with patch.object(knowledge_ingestion, "UPLOADS_DIR", storage_root):
            with Session(engine) as session:
                actor_id, source_id, document_id, original_key = _indexed_document(
                    session,
                    storage_root,
                )
                storage = StorageService(storage_root)
                before = session.get(KnowledgeV1Document, document_id)
                assert before is not None
                old_extracted_key = before.extracted_text_storage_key
                old_chunks_key = before.chunks_storage_key
                old_files = _artifact_files(storage_root, document_id)
                new_original_key = _commit_new_original(
                    session,
                    storage_root,
                    source_id=source_id,
                    document_id=document_id,
                    content=b"# Version B\nThis reindex must not survive DB flush failure.",
                )

                real_flush = session.flush

                def fail_storage_transaction_flush(*args, **kwargs):
                    if session.info.get(
                        knowledge_ingestion._PENDING_STORAGE_WRITES_KEY
                    ):
                        raise RuntimeError("forced DB flush failure")
                    return real_flush(*args, **kwargs)

                with patch.object(
                    session,
                    "flush",
                    side_effect=fail_storage_transaction_flush,
                ):
                    with pytest.raises(RuntimeError, match="forced DB flush failure"):
                        index_document_actor_aware(
                            session,
                            document_id,
                            final_authorize=_final_authorizer(
                                session,
                                actor_id=actor_id,
                                source_id=source_id,
                                document_id=document_id,
                            ),
                        )

                session.expire_all()
                current = session.get(KnowledgeV1Document, document_id)
                assert current is not None
                assert current.original_storage_key == new_original_key
                assert current.content_hash in new_original_key
                assert current.extracted_text_storage_key == old_extracted_key
                assert current.chunks_storage_key == old_chunks_key
                assert _artifact_files(storage_root, document_id) == old_files
        engine.dispose()


def test_reader_keeps_old_immutable_artifact_until_reindex_commit() -> None:
    with TemporaryDirectory() as temp_dir:
        root = Path(temp_dir)
        storage_root = root / "uploads"
        engine = _engine(root / "aria.db")
        with patch.object(knowledge_ingestion, "UPLOADS_DIR", storage_root):
            with Session(engine) as writer:
                actor_id, source_id, document_id, original_key = _indexed_document(
                    writer,
                    storage_root,
                )
                storage = StorageService(storage_root)
                before = writer.get(KnowledgeV1Document, document_id)
                assert before is not None
                old_key = before.extracted_text_storage_key
                old_payload = storage.read_bytes(old_key)
                _commit_new_original(
                    writer,
                    storage_root,
                    source_id=source_id,
                    document_id=document_id,
                    content=b"# Version B\nConcurrent readers must stay on committed A.",
                )

                staged, _ = index_document_actor_aware(
                    writer,
                    document_id,
                    final_authorize=_final_authorizer(
                        writer,
                        actor_id=actor_id,
                        source_id=source_id,
                        document_id=document_id,
                    ),
                )
                new_key = staged.extracted_text_storage_key
                assert new_key != old_key

                with Session(engine) as reader:
                    visible = reader.get(KnowledgeV1Document, document_id)
                    assert visible is not None
                    assert visible.extracted_text_storage_key == old_key
                    assert storage.read_bytes(visible.extracted_text_storage_key) == old_payload

                writer.commit()

            with Session(engine) as reader:
                visible = reader.get(KnowledgeV1Document, document_id)
                assert visible is not None
                assert visible.extracted_text_storage_key == new_key
                assert b"Concurrent readers" in storage.read_bytes(new_key)
                # A reader that captured the prior committed key before the
                # commit can still finish safely afterward.
                assert storage.read_bytes(old_key) == old_payload
        engine.dispose()


def test_session_close_discards_uncommitted_reindex_versions() -> None:
    with TemporaryDirectory() as temp_dir:
        root = Path(temp_dir)
        storage_root = root / "uploads"
        engine = _engine(root / "aria.db")
        with patch.object(knowledge_ingestion, "UPLOADS_DIR", storage_root):
            writer = Session(engine)
            actor_id, source_id, document_id, original_key = _indexed_document(
                writer,
                storage_root,
            )
            storage = StorageService(storage_root)
            before = writer.get(KnowledgeV1Document, document_id)
            assert before is not None
            old_extracted_key = before.extracted_text_storage_key
            old_chunks_key = before.chunks_storage_key
            old_files = _artifact_files(storage_root, document_id)
            _commit_new_original(
                writer,
                storage_root,
                source_id=source_id,
                document_id=document_id,
                content=b"# Version B\nClosing the Session must discard this version.",
            )
            staged, _ = index_document_actor_aware(
                writer,
                document_id,
                final_authorize=_final_authorizer(
                    writer,
                    actor_id=actor_id,
                    source_id=source_id,
                    document_id=document_id,
                ),
            )
            assert staged.extracted_text_storage_key != old_extracted_key
            writer.close()

            assert _artifact_files(storage_root, document_id) == old_files
            with Session(engine) as reader:
                current = reader.get(KnowledgeV1Document, document_id)
                assert current is not None
                assert current.extracted_text_storage_key == old_extracted_key
                assert current.chunks_storage_key == old_chunks_key
        engine.dispose()


def test_scan_commit_failure_leaves_no_original_or_database_orphan() -> None:
    with TemporaryDirectory() as temp_dir:
        root = Path(temp_dir)
        storage_root = root / "uploads"
        source_root = root / "source"
        source_root.mkdir()
        (source_root / "scan.md").write_text("# Scan me", encoding="utf-8")
        engine = _engine(root / "aria.db")
        with patch.object(knowledge_ingestion, "UPLOADS_DIR", storage_root):
            with Session(engine) as session:
                source = KnowledgeSource(
                    name="Scanned source",
                    source_type="markdown_folder",
                    scope_type="global",
                    config_json=f'{{"root_path": "{source_root}"}}',
                )
                session.add(source)
                session.commit()
                session.refresh(source)
                source_id = int(source.id)

                with patch.object(
                    session,
                    "commit",
                    side_effect=RuntimeError("forced scan commit failure"),
                ):
                    with pytest.raises(RuntimeError, match="forced scan commit failure"):
                        scan_source_files(session, source_id)

                assert session.exec(
                    select(KnowledgeV1Document).where(
                        KnowledgeV1Document.source_id == source_id
                    )
                ).all() == []
                assert session.exec(select(KnowledgeDocumentEvent)).all() == []
                originals = storage_root / "knowledge" / "originals" / f"source-{source_id}"
                assert not originals.exists() or list(originals.iterdir()) == []
        engine.dispose()


def test_scan_deduplication_removes_unreferenced_unique_copy() -> None:
    with TemporaryDirectory() as temp_dir:
        root = Path(temp_dir)
        storage_root = root / "uploads"
        source_root = root / "source"
        source_root.mkdir()
        (source_root / "scan.md").write_text("# Stable scan", encoding="utf-8")
        engine = _engine(root / "aria.db")
        with patch.object(knowledge_ingestion, "UPLOADS_DIR", storage_root):
            with Session(engine) as session:
                source = KnowledgeSource(
                    name="Deduplicated scan source",
                    source_type="markdown_folder",
                    scope_type="global",
                    config_json=f'{{"root_path": "{source_root}"}}',
                )
                session.add(source)
                session.commit()
                session.refresh(source)
                source_id = int(source.id)

                first = scan_source_files(session, source_id)
                assert len(first) == 1
                original_key = first[0].original_storage_key
                originals = (
                    storage_root
                    / "knowledge"
                    / "originals"
                    / f"source-{source_id}"
                )
                assert len(list(originals.iterdir())) == 1

                second = scan_source_files(session, source_id)
                assert len(second) == 1
                assert int(second[0].id) == int(first[0].id)
                assert second[0].original_storage_key == original_key
                assert len(list(originals.iterdir())) == 1
                assert len(
                    session.exec(
                        select(KnowledgeV1Document).where(
                            KnowledgeV1Document.source_id == source_id
                        )
                    ).all()
                ) == 1
        engine.dispose()


def test_storage_put_bytes_atomically_publishes_complete_content() -> None:
    with TemporaryDirectory() as temp_dir:
        storage = StorageService(Path(temp_dir))
        storage_key = "knowledge/chunks/1/chunks.json"
        storage.put_bytes(storage_key, b"old-complete-value")
        destination = storage.resolve_path(storage_key)
        real_replace = os.replace
        observations: list[bytes] = []

        def observe_then_replace(source, target):
            observations.append(destination.read_bytes())
            assert Path(source).read_bytes() == b"new-complete-value"
            real_replace(source, target)

        with patch("app.services.storage.os.replace", side_effect=observe_then_replace):
            storage.put_bytes(storage_key, b"new-complete-value")

        assert observations == [b"old-complete-value"]
        assert storage.read_bytes(storage_key) == b"new-complete-value"
        assert list(destination.parent.glob(f".{destination.name}.*.tmp")) == []
