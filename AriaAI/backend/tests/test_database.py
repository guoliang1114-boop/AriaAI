"""Shared test database utilities.

All tests should use create_test_engine() instead of hard-coding a database
URL. The test database URL can be overridden via the TEST_DATABASE_URL
environment variable.
"""
from __future__ import annotations

import os

from sqlalchemy import inspect, text
from sqlmodel import create_engine

DEFAULT_TEST_DATABASE_URL = "postgresql://postgres:password@localhost:5432/ariaai_test"
TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", DEFAULT_TEST_DATABASE_URL)


def create_test_engine():
    """Create a SQLAlchemy engine pointing at the test PostgreSQL database."""
    return create_engine(TEST_DATABASE_URL)


def drop_all_tables(engine) -> None:
    """Drop all tables in the current database for test isolation."""
    inspector = inspect(engine)
    table_names = inspector.get_table_names()
    with engine.begin() as conn:
        for table in reversed(table_names):
            conn.execute(text(f'DROP TABLE IF EXISTS "{table}" CASCADE'))
