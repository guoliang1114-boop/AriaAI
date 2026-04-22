#!/usr/bin/env python3
"""Ensure production database has the required additive schema and sane Alembic state.

This script is intentionally idempotent:
- missing additive columns/tables are created
- existing objects are left untouched
- alembic_version is stamped only when missing or empty
- the target revision is derived from local Alembic files, not hardcoded
"""

from __future__ import annotations

import argparse
import os
import sys

from sqlalchemy import inspect, text

# Add parent directory to path so app imports work
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("PYTHONIOENCODING", "utf-8")

from app.database import (  # noqa: E402
    _get_local_alembic_revisions,
    _normalize_alembic_revision,
    engine,
    get_database_migration_governance,
)


def _print_governance(prefix: str, tables: list[str], current_revision: str | None) -> None:
    governance = get_database_migration_governance(
        tables=tables,
        current_revision=current_revision,
    )
    print(f"{prefix} migration mode: {governance['mode']}")
    print(f"{prefix} current revision: {governance['current_revision']}")
    print(f"{prefix} latest revision: {governance['latest_revision']}")
    print(f"{prefix} pending revisions: {', '.join(governance['pending_revisions']) or 'none'}")


def _get_current_revision(conn, tables: list[str]) -> str | None:
    if "alembic_version" not in tables:
        return None
    try:
        return conn.execute(text("SELECT version_num FROM alembic_version LIMIT 1")).scalar()
    except Exception:
        return None


def _ensure_project_columns(conn, inspector, report_only: bool) -> None:
    cols = {c["name"] for c in inspector.get_columns("project")}
    if "md_notes" not in cols:
        print("Add column project.md_notes")
        if not report_only:
            conn.execute(text("ALTER TABLE project ADD COLUMN md_notes TEXT NOT NULL DEFAULT ''"))
    else:
        print("project.md_notes already exists")


def _ensure_projecttodo(conn, inspector, report_only: bool) -> None:
    tables = inspector.get_table_names()
    if "projecttodo" not in tables:
        print("Create table projecttodo")
        if not report_only:
            conn.execute(
                text(
                    """
                    CREATE TABLE projecttodo (
                        id SERIAL PRIMARY KEY,
                        project_id INTEGER NOT NULL,
                        content TEXT NOT NULL,
                        is_done BOOLEAN NOT NULL DEFAULT false,
                        assigned_to_user_id INTEGER,
                        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        CONSTRAINT fk_projecttodo_project FOREIGN KEY (project_id) REFERENCES project(id)
                    )
                    """
                )
            )
            conn.execute(text("CREATE INDEX ix_projecttodo_project_id ON projecttodo (project_id)"))
            conn.execute(text("CREATE INDEX ix_projecttodo_assigned_to_user_id ON projecttodo (assigned_to_user_id)"))
        return

    print("projecttodo already exists")
    todo_cols = {c["name"] for c in inspector.get_columns("projecttodo")}
    if "assigned_to_user_id" not in todo_cols:
        print("Add column projecttodo.assigned_to_user_id")
        if not report_only:
            conn.execute(text("ALTER TABLE projecttodo ADD COLUMN assigned_to_user_id INTEGER"))
            conn.execute(text("CREATE INDEX ix_projecttodo_assigned_to_user_id ON projecttodo (assigned_to_user_id)"))
    else:
        print("projecttodo.assigned_to_user_id already exists")


def _ensure_projectmember(conn, inspector, report_only: bool) -> None:
    if "projectmember" in inspector.get_table_names():
        print("projectmember already exists")
        return

    print("Create table projectmember")
    if report_only:
        return
    conn.execute(
        text(
            """
            CREATE TABLE projectmember (
                id SERIAL PRIMARY KEY,
                project_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT fk_projectmember_project FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE,
                CONSTRAINT fk_projectmember_user FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE
            )
            """
        )
    )
    conn.execute(text("CREATE INDEX ix_projectmember_project_id ON projectmember (project_id)"))
    conn.execute(text("CREATE INDEX ix_projectmember_user_id ON projectmember (user_id)"))


def _ensure_knowledge_document_project(conn, inspector, report_only: bool) -> None:
    if "knowledgedocument" not in inspector.get_table_names():
        print("knowledgedocument not present, skip project_id check")
        return

    kd_cols = {c["name"] for c in inspector.get_columns("knowledgedocument")}
    if "project_id" in kd_cols:
        print("knowledgedocument.project_id already exists")
        return

    print("Add column knowledgedocument.project_id")
    if not report_only:
        conn.execute(text("ALTER TABLE knowledgedocument ADD COLUMN project_id INTEGER"))
        conn.execute(text("CREATE INDEX ix_knowledgedocument_project_id ON knowledgedocument (project_id)"))


def _ensure_clientstakeholder(conn, inspector, report_only: bool) -> None:
    if "clientstakeholder" in inspector.get_table_names():
        print("clientstakeholder already exists")
        return

    print("Create table clientstakeholder")
    if report_only:
        return
    conn.execute(
        text(
            """
            CREATE TABLE clientstakeholder (
                id SERIAL PRIMARY KEY,
                client_id INTEGER NOT NULL,
                name VARCHAR NOT NULL,
                role VARCHAR NOT NULL DEFAULT '',
                organization_level VARCHAR NOT NULL DEFAULT '',
                influence_type VARCHAR NOT NULL DEFAULT '',
                relationship_status VARCHAR NOT NULL DEFAULT 'unknown',
                concerns TEXT NOT NULL DEFAULT '',
                sensitivities TEXT NOT NULL DEFAULT '',
                communication_preference TEXT NOT NULL DEFAULT '',
                contact VARCHAR NOT NULL DEFAULT '',
                last_action TEXT NOT NULL DEFAULT '',
                note TEXT NOT NULL DEFAULT '',
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT fk_clientstakeholder_client FOREIGN KEY (client_id) REFERENCES clientrecord(id) ON DELETE CASCADE
            )
            """
        )
    )
    conn.execute(text("CREATE INDEX ix_clientstakeholder_client_id ON clientstakeholder (client_id)"))


def _ensure_projectmemorysnapshot(conn, inspector, report_only: bool) -> None:
    if "projectmemorysnapshot" in inspector.get_table_names():
        print("projectmemorysnapshot already exists")
        return

    print("Create table projectmemorysnapshot")
    if report_only:
        return
    conn.execute(
        text(
            """
            CREATE TABLE projectmemorysnapshot (
                id SERIAL PRIMARY KEY,
                project_id INTEGER NOT NULL,
                memory_version INTEGER NOT NULL,
                trigger VARCHAR NOT NULL DEFAULT '',
                memory_json TEXT NOT NULL DEFAULT '',
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT fk_projectmemorysnapshot_project FOREIGN KEY (project_id) REFERENCES project(id)
            )
            """
        )
    )
    conn.execute(text("CREATE INDEX ix_projectmemorysnapshot_project_id ON projectmemorysnapshot (project_id)"))
    conn.execute(text("CREATE INDEX ix_projectmemorysnapshot_memory_version ON projectmemorysnapshot (memory_version)"))
    conn.execute(text("CREATE INDEX ix_projectmemorysnapshot_trigger ON projectmemorysnapshot (trigger)"))
    conn.execute(text("CREATE INDEX ix_projectmemorysnapshot_created_at ON projectmemorysnapshot (created_at)"))


def _ensure_alembic_version(conn, inspector, report_only: bool) -> None:
    tables = inspector.get_table_names()
    governance = get_database_migration_governance(tables=tables)
    latest_revision = governance.get("latest_revision")

    if not latest_revision:
        print("No local Alembic revisions found, skip stamping")
        return

    if "alembic_version" not in tables:
        print(f"Create alembic_version and stamp to {latest_revision}")
        if not report_only:
            conn.execute(text("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL PRIMARY KEY)"))
            conn.execute(
                text("INSERT INTO alembic_version (version_num) VALUES (:revision)"),
                {"revision": latest_revision},
            )
        return

    versions = [row[0] for row in conn.execute(text("SELECT version_num FROM alembic_version")).fetchall()]
    if not versions:
        print(f"alembic_version exists but is empty, stamp to {latest_revision}")
        if not report_only:
            conn.execute(
                text("INSERT INTO alembic_version (version_num) VALUES (:revision)"),
                {"revision": latest_revision},
            )
        return

    local_revisions = _get_local_alembic_revisions()
    if len(versions) == 1:
        normalized_revision = _normalize_alembic_revision(versions[0], local_revisions)
        if normalized_revision and normalized_revision != versions[0]:
            print(f"Normalize alembic_version {versions[0]} -> {normalized_revision}")
            if not report_only:
                conn.execute(
                    text("UPDATE alembic_version SET version_num = :normalized WHERE version_num = :current"),
                    {"current": versions[0], "normalized": normalized_revision},
                )
            return

    print(f"Current alembic versions: {versions}")


def _ensure_release_message(conn, inspector, report_only: bool) -> None:
    if "systemmessage" not in inspector.get_table_names():
        print("systemmessage not present, skip release message seed")
        return

    release_title = "AriaAI 已支持 Kimi K2.6"
    existing = conn.execute(
        text("SELECT id FROM systemmessage WHERE title = :title LIMIT 1"),
        {"title": release_title},
    ).scalar()
    if existing:
        print("Kimi K2.6 release message already exists")
        return

    print("Create Kimi K2.6 release message")
    if report_only:
        return
    conn.execute(
        text(
            """
            INSERT INTO systemmessage (
                title,
                content,
                level,
                link,
                is_published,
                created_by_user_id,
                created_at,
                updated_at
            )
            VALUES (
                :title,
                :content,
                'success',
                '/settings/ai',
                true,
                NULL,
                CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP
            )
            """
        ),
        {
            "title": release_title,
            "content": (
                "本次升级已将 Kimi 默认模型切换到 kimi-k2.6。原 Kimi 2.5 的 API Key "
                "可继续使用，无需重新配置。项目总结、长程上下文和 Agent 工具调用会获得更好的稳定性。"
            ),
        },
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Ensure additive schema and Alembic stamp are present.")
    parser.add_argument(
        "--report-only",
        action="store_true",
        help="Print the actions that would be taken without writing to the database.",
    )
    args = parser.parse_args()

    inspector = inspect(engine)
    with engine.begin() as conn:
        tables_before = inspector.get_table_names()
        _print_governance("Before", tables_before, _get_current_revision(conn, tables_before))

        _ensure_project_columns(conn, inspector, args.report_only)
        _ensure_projecttodo(conn, inspector, args.report_only)
        _ensure_projectmember(conn, inspector, args.report_only)
        _ensure_knowledge_document_project(conn, inspector, args.report_only)
        _ensure_clientstakeholder(conn, inspector, args.report_only)
        _ensure_projectmemorysnapshot(conn, inspector, args.report_only)

        inspector = inspect(conn)
        _ensure_alembic_version(conn, inspector, args.report_only)
        _ensure_release_message(conn, inspector, args.report_only)

        inspector = inspect(conn)
        tables_after = inspector.get_table_names()
        _print_governance("After", tables_after, _get_current_revision(conn, tables_after))

    print("Database schema check completed.")


if __name__ == "__main__":
    main()
