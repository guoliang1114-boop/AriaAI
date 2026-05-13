#!/usr/bin/env python3
"""Manual database connectivity check.

This file is intentionally not a unittest module. Run it directly when you need
to verify the configured database connection:

    python scripts/test_db.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def load_local_env() -> None:
    env_path = Path(__file__).parent / ".env"
    if not env_path.exists():
        return

    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key, value)


def main() -> int:
    load_local_env()

    from app.config import DATABASE_URL

    print(f"Current database config: {DATABASE_URL}")
    print()

    if not DATABASE_URL.startswith("postgresql"):
        print("ERROR: Only PostgreSQL is supported. Please set DATABASE_URL to a valid PostgreSQL connection string.")
        return 1

    try:
        import psycopg2
    except ImportError:
        print("Missing psycopg2. Install it with: pip install psycopg2-binary")
        return 1

    try:
        conn = psycopg2.connect(DATABASE_URL, connect_timeout=10)
    except Exception as exc:
        print(f"Connection failed: {exc}")
        return 1

    with conn:
        with conn.cursor() as cur:
            cur.execute("SELECT version();")
            version = cur.fetchone()[0]
            print("Connection succeeded.")
            print(f"PostgreSQL: {version}")

            cur.execute("SELECT current_database(), current_user;")
            db_name, user = cur.fetchone()
            print(f"Database: {db_name}")
            print(f"User: {user}")

            cur.execute(
                """
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = 'public'
                ORDER BY table_name
                """
            )
            tables = [row[0] for row in cur.fetchall()]
            if tables:
                print(f"\nTables ({len(tables)}):")
                for table in tables:
                    print(f"- {table}")
            else:
                print("\nDatabase is empty; run migrations or ensure_db first.")

    conn.close()
    print("\nDatabase connectivity check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
