#!/usr/bin/env python3
"""Print a read-only, content-free knowledge retrieval authority audit."""
from __future__ import annotations

import json
import sys
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlmodel import Session

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import DATABASE_URL
from app.services.knowledge_read_authority import (
    build_knowledge_read_authority_report,
)


def main() -> int:
    engine = create_engine(DATABASE_URL)
    try:
        with Session(engine) as session:
            if engine.dialect.name == "postgresql":
                session.connection().execute(text("SET TRANSACTION READ ONLY"))
            report = build_knowledge_read_authority_report(session)
    finally:
        engine.dispose()
    print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
