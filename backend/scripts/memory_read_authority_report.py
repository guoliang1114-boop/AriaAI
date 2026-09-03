#!/usr/bin/env python3
"""Print a content-free aggregate-memory compatibility audit."""
from __future__ import annotations

import json
import sys
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlmodel import Session, select

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import DATABASE_URL
from app.models.db import ClientRecord, Project
from app.services.client_contexts import get_client_memory_payload
from app.services.memory_slots import (
    get_client_memory_read_authority_report,
    get_project_memory_read_authority_report,
    summarize_memory_read_authority,
)
from app.services.project_contexts import get_project_memory_payload


def build_report(session: Session) -> dict[str, object]:
    projects = session.exec(
        select(Project).where(Project.memory_version > 0).order_by(Project.id)
    ).all()
    clients = session.exec(
        select(ClientRecord)
        .where(ClientRecord.client_memory_version > 0)
        .order_by(ClientRecord.id)
    ).all()
    project_reports = [
        get_project_memory_read_authority_report(
            session,
            project,
            get_project_memory_payload(project),
        )
        for project in projects
    ]
    client_reports = [
        get_client_memory_read_authority_report(
            session,
            client,
            get_client_memory_payload(client),
        )
        for client in clients
    ]
    return {
        "schema_version": 1,
        "content_included": False,
        "project": summarize_memory_read_authority(project_reports),
        "client": summarize_memory_read_authority(client_reports),
    }


def main() -> int:
    engine = create_engine(DATABASE_URL)
    try:
        with Session(engine) as session:
            if engine.dialect.name == "postgresql":
                session.connection().execute(text("SET TRANSACTION READ ONLY"))
            report = build_report(session)
    finally:
        engine.dispose()
    print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
