"""Shared test database utilities.

All tests should use create_test_engine() instead of hard-coding a database
URL. The test database URL can be overridden via the TEST_DATABASE_URL
environment variable.

When pytest-xdist is used, each worker is routed to its own PostgreSQL schema.
That keeps legacy tests that call drop_all_tables() from racing each other on
the same shared database.
"""
from __future__ import annotations

import os
import re

from sqlalchemy import inspect, text
from sqlmodel import create_engine

DEFAULT_TEST_DATABASE_URL = "postgresql://postgres:password@localhost:5432/ariaai_test"
TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", DEFAULT_TEST_DATABASE_URL)


def _xdist_schema_name() -> str | None:
    worker_id = os.getenv("PYTEST_XDIST_WORKER")
    if not worker_id or not TEST_DATABASE_URL.startswith("postgresql"):
        return None
    safe_worker_id = re.sub(r"[^A-Za-z0-9_]", "_", worker_id)
    return f"ariaai_test_{safe_worker_id}"


def create_test_engine():
    """Create a SQLAlchemy engine pointing at the test PostgreSQL database."""
    schema_name = _xdist_schema_name()
    if not schema_name:
        return create_engine(TEST_DATABASE_URL)

    bootstrap_engine = create_engine(TEST_DATABASE_URL)
    with bootstrap_engine.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{schema_name}"'))
    bootstrap_engine.dispose()
    return create_engine(TEST_DATABASE_URL, connect_args={"options": f"-csearch_path={schema_name},public"})


def drop_all_tables(engine) -> None:
    """Drop all tables in the current database for test isolation."""
    inspector = inspect(engine)
    table_names = inspector.get_table_names()
    with engine.begin() as conn:
        for table in reversed(table_names):
            conn.execute(text(f'DROP TABLE IF EXISTS "{table}" CASCADE'))
