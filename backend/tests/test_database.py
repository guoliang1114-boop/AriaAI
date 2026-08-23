"""Shared test database utilities.

All tests should use create_test_engine() instead of hard-coding a database
URL. The test database URL can be overridden via the TEST_DATABASE_URL
environment variable.

Every test *process* is routed to its own PostgreSQL schema so that concurrent
test runs (pytest-xdist workers, or two pytest invocations sharing one database)
never race each other on the same tables. Under pytest-xdist the schema is keyed
on the worker id (stable, reused across the worker's lifetime); otherwise a
unique per-process schema is created and dropped again at interpreter exit.
Within a process all engines share that one schema, so tests that create several
engines still see the same data; per-test isolation continues to come from the
drop_all_tables() + create_all() calls in each TestCase's setUp. PostgreSQL test
connections deliberately exclude ``public`` from ``search_path`` and destructive
helpers fail closed unless the active schema has the ``ariaai_test_`` prefix.
"""
from __future__ import annotations

import atexit
import os
import re
import uuid

from sqlalchemy import inspect, text
from sqlmodel import create_engine

DEFAULT_TEST_DATABASE_URL = "postgresql://postgres:password@localhost:5432/ariaai_test"
TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", DEFAULT_TEST_DATABASE_URL)

_PROCESS_SCHEMA: str | None = None
_SAFE_TEST_SCHEMA_PATTERN = re.compile(r"ariaai_test_[A-Za-z0-9_]+\Z")


def _xdist_schema_name() -> str | None:
    """Return the stable schema name for the current xdist worker, if any."""
    if not TEST_DATABASE_URL.startswith("postgresql"):
        return None
    worker_id = os.getenv("PYTEST_XDIST_WORKER")
    if not worker_id:
        return None
    safe_worker_id = re.sub(r"[^A-Za-z0-9_]", "_", worker_id)
    return f"ariaai_test_{safe_worker_id}"


def _resolve_schema_name() -> str | None:
    """Return the schema this process should use, or None for non-PostgreSQL URLs.

    Cached per process. Under pytest-xdist the worker id keeps the name stable
    (and reused), so no atexit cleanup is registered for it. For a plain serial
    run a unique schema is minted once and registered for drop at exit.
    """
    global _PROCESS_SCHEMA
    if _PROCESS_SCHEMA is not None:
        return _PROCESS_SCHEMA
    if not TEST_DATABASE_URL.startswith("postgresql"):
        return None

    worker_schema = _xdist_schema_name()
    if worker_schema:
        _PROCESS_SCHEMA = worker_schema
    else:
        _PROCESS_SCHEMA = f"ariaai_test_p{os.getpid()}_{uuid.uuid4().hex[:8]}"
        atexit.register(_drop_process_schema)
    return _PROCESS_SCHEMA


def _drop_process_schema() -> None:
    if not _PROCESS_SCHEMA:
        return
    engine = create_engine(TEST_DATABASE_URL)
    try:
        with engine.begin() as conn:
            conn.execute(text(f'DROP SCHEMA IF EXISTS "{_PROCESS_SCHEMA}" CASCADE'))
    finally:
        engine.dispose()


def create_test_engine():
    """Create a SQLAlchemy engine pointing at this process's test schema."""
    schema_name = _resolve_schema_name()
    if not schema_name:
        return create_engine(TEST_DATABASE_URL)

    bootstrap_engine = create_engine(TEST_DATABASE_URL)
    with bootstrap_engine.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{schema_name}"'))
    bootstrap_engine.dispose()
    return create_engine(
        TEST_DATABASE_URL,
        connect_args={"options": f"-csearch_path={schema_name}"},
    )


def _require_isolated_postgres_schema(engine) -> str:
    """Return the active test schema or refuse destructive test cleanup."""

    with engine.connect() as connection:
        schema_name, search_path = connection.execute(
            text("SELECT current_schema(), current_setting('search_path')")
        ).one()
    schema_name = str(schema_name or "")
    search_path_parts = {
        part.strip().strip('"') for part in str(search_path or "").split(",")
    }
    if not _SAFE_TEST_SCHEMA_PATTERN.fullmatch(schema_name):
        raise RuntimeError(
            "Refusing destructive test cleanup outside an ariaai_test_* schema: "
            f"current_schema={schema_name!r}"
        )
    if "public" in search_path_parts:
        raise RuntimeError(
            "Refusing destructive test cleanup while public is in search_path: "
            f"search_path={search_path!r}"
        )
    return schema_name


def drop_all_tables(engine) -> None:
    """Drop test-schema tables while refusing access to PostgreSQL ``public``."""

    inspector = inspect(engine)
    schema_name = None
    if engine.dialect.name == "postgresql":
        schema_name = _require_isolated_postgres_schema(engine)
    table_names = inspector.get_table_names(schema=schema_name)
    with engine.begin() as conn:
        for table in reversed(table_names):
            qualified_table = (
                f'"{schema_name}"."{table}"' if schema_name else f'"{table}"'
            )
            conn.execute(text(f"DROP TABLE IF EXISTS {qualified_table} CASCADE"))
