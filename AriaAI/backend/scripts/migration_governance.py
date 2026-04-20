#!/usr/bin/env python3
"""Operational wrapper for AriaAI database migration governance.

The script is intentionally conservative:
- `report` only reads the database and local Alembic files.
- `ensure` applies additive safety checks from ensure_db.py.
- `upgrade` runs Alembic normally after printing governance state.
- `check` exits non-zero when Alembic-managed databases have pending revisions.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("PYTHONIOENCODING", "utf-8")

BACKEND_DIR = Path(__file__).resolve().parent.parent


def _load_database_helpers():
    from app.database import get_database_health, get_database_migration_governance

    return get_database_health, get_database_migration_governance


def _print_governance(title: str) -> dict:
    get_database_health, _ = _load_database_helpers()
    health = get_database_health()
    governance = health["alembic"]
    print(f"\n== {title} ==")
    print(f"database: {health['database_url']}")
    print(f"tables: {health['table_count']}")
    print(f"mode: {governance['mode']}")
    print(f"current_revision: {governance['current_revision']}")
    print(f"latest_revision: {governance['latest_revision']}")
    print(f"pending_count: {governance['pending_count']}")
    print(f"pending_revisions: {', '.join(governance['pending_revisions']) or 'none'}")
    return governance


def _run(command: list[str]) -> int:
    print(f"\n$ {' '.join(command)}")
    completed = subprocess.run(command, cwd=BACKEND_DIR, check=False)
    return completed.returncode


def main() -> int:
    parser = argparse.ArgumentParser(description="Inspect and operate AriaAI Alembic migration governance.")
    parser.add_argument(
        "action",
        choices=["report", "ensure", "upgrade", "current", "check", "json"],
        help="Operation to run.",
    )
    args = parser.parse_args()

    if args.action == "json":
        get_database_health, _ = _load_database_helpers()
        print(json.dumps(get_database_health(), ensure_ascii=False, indent=2))
        return 0

    if args.action == "report":
        _print_governance("Migration governance report")
        return 0

    if args.action == "current":
        _print_governance("Before alembic current")
        return _run(["alembic", "current"])

    if args.action == "check":
        _, get_database_migration_governance = _load_database_helpers()
        governance = get_database_migration_governance()
        pending_count = int(governance.get("pending_count") or 0)
        mode = governance.get("mode")
        if mode == "alembic" and pending_count > 0:
            print(f"Pending Alembic revisions detected: {pending_count}")
            return 2
        if mode == "lightweight":
            print("Legacy lightweight database detected. Run `ensure` before deployment and plan an Alembic stamp.")
            return 1
        print("Migration governance check passed.")
        return 0

    if args.action == "ensure":
        _print_governance("Before ensure_db")
        code = _run([sys.executable, "scripts/ensure_db.py"])
        _print_governance("After ensure_db")
        return code

    if args.action == "upgrade":
        _print_governance("Before alembic upgrade")
        code = _run(["alembic", "upgrade", "head"])
        _print_governance("After alembic upgrade")
        return code

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
