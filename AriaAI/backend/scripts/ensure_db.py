#!/usr/bin/env python3
"""Ensure production database has all required schema for current models."""
import os
import sys

# Add parent directory to path so app imports work
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault("PYTHONIOENCODING", "utf-8")

from sqlalchemy import create_engine, inspect, text  # noqa: E402
from app.config import DATABASE_URL  # noqa: E402


def main():
    engine = create_engine(DATABASE_URL)
    inspector = inspect(engine)

    with engine.begin() as conn:
        # 1. Ensure md_notes column on project
        cols = {c["name"] for c in inspector.get_columns("project")}
        if "md_notes" not in cols:
            conn.execute(
                text("ALTER TABLE project ADD COLUMN md_notes TEXT NOT NULL DEFAULT ''")
            )
            print("Added md_notes to project")
        else:
            print("md_notes already exists")

        # 2. Ensure projecttodo table
        if "projecttodo" not in inspector.get_table_names():
            conn.execute(
                text(
                    """
                    CREATE TABLE projecttodo (
                        id SERIAL PRIMARY KEY,
                        project_id INTEGER NOT NULL,
                        content TEXT NOT NULL,
                        is_done BOOLEAN NOT NULL DEFAULT false,
                        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        CONSTRAINT fk_projecttodo_project FOREIGN KEY (project_id) REFERENCES project(id)
                    )
                    """
                )
            )
            conn.execute(
                text("CREATE INDEX ix_projecttodo_project_id ON projecttodo (project_id)")
            )
            print("Created projecttodo table")
        else:
            print("projecttodo already exists")

        # 3. Ensure alembic_version table is present and stamped
        if "alembic_version" not in inspector.get_table_names():
            conn.execute(
                text(
                    "CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL PRIMARY KEY)"
                )
            )
            conn.execute(
                text("INSERT INTO alembic_version (version_num) VALUES ('002_v1_2')")
            )
            print("Created alembic_version table")
            print("Stamped alembic_version to 002_v1_2")
        else:
            versions = [
                r[0] for r in conn.execute(text("SELECT version_num FROM alembic_version")).fetchall()
            ]
            print("Current alembic versions:", versions)

    print("Database schema check completed.")


if __name__ == "__main__":
    main()
