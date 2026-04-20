from pathlib import Path
import re

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import inspect, text
from sqlmodel import SQLModel, Session, create_engine

from app.config import DATABASE_URL

engine_kwargs = {
    "echo": False,
}

if DATABASE_URL.startswith("sqlite"):
    engine_kwargs["connect_args"] = {"check_same_thread": False}
else:
    engine_kwargs.update(
        pool_size=10,
        max_overflow=10,
        pool_recycle=300,
        pool_timeout=60,
        pool_pre_ping=True,
    )

engine = create_engine(DATABASE_URL, **engine_kwargs)


def _get_local_alembic_revisions() -> list[str]:
    backend_dir = Path(__file__).resolve().parent.parent
    alembic_ini = backend_dir / "alembic.ini"
    alembic_dir = backend_dir / "alembic" / "versions"
    if not alembic_ini.exists() or not alembic_dir.exists():
        return []

    try:
        config = Config(str(alembic_ini))
        config.set_main_option("script_location", str(backend_dir / "alembic"))
        script = ScriptDirectory.from_config(config)
        return [revision.revision for revision in reversed(list(script.walk_revisions()))]
    except Exception:
        pass

    revisions: list[str] = []
    for item in alembic_dir.iterdir():
        if not item.is_file() or item.suffix != ".py":
            continue
        match = re.search(r"^revision\s*=\s*['\"]([^'\"]+)['\"]", item.read_text(encoding="utf-8"), re.MULTILINE)
        if match:
            revisions.append(match.group(1))

    return sorted(revisions)


def _normalize_alembic_revision(revision: str | None, local_revisions: list[str]) -> str | None:
    if not revision:
        return None
    if revision in local_revisions:
        return revision

    # Legacy deploy scripts used filename prefixes like 005 as revision IDs.
    # Normalize those short aliases to the real Alembic IDs such as 005_v1_5.
    matches = [item for item in local_revisions if item.startswith(f"{revision}_")]
    if len(matches) == 1:
        return matches[0]
    return revision


def create_db():
    """Create missing tables only."""
    SQLModel.metadata.create_all(engine)


def migrate_db():
    """Lightweight additive migrations for existing databases.

    This only adds missing nullable/defaulted columns. It does not handle
    destructive schema changes or type rewrites.
    """

    def _column_type_sql(column) -> str:
        return column.type.compile(dialect=engine.dialect)

    def _default_sql(column):
        if column.server_default is not None and hasattr(column.server_default, "arg"):
            arg = column.server_default.arg
            if isinstance(arg, bool):
                return "true" if arg else "false"
            if isinstance(arg, str):
                escaped = arg.replace("'", "''")
                return f"'{escaped}'"
            return str(arg)

        if column.default is not None and getattr(column.default, "is_scalar", False):
            value = column.default.arg
            if isinstance(value, bool):
                if DATABASE_URL.startswith("sqlite"):
                    return "1" if value else "0"
                return "true" if value else "false"
            if isinstance(value, (int, float)):
                return str(value)
            if value is None:
                return "NULL"
            escaped = str(value).replace("'", "''")
            return f"'{escaped}'"

        return None

    inspector = inspect(engine)

    with engine.begin() as conn:
        existing_tables = set(inspector.get_table_names())
        for table in SQLModel.metadata.sorted_tables:
            if table.name not in existing_tables:
                continue

            existing_columns = {col["name"] for col in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in existing_columns or column.primary_key:
                    continue

                sql = f"ALTER TABLE {table.name} ADD COLUMN {column.name} {_column_type_sql(column)}"
                default_sql = _default_sql(column)
                if default_sql is not None:
                    sql += f" DEFAULT {default_sql}"
                if not column.nullable and default_sql is not None:
                    sql += " NOT NULL"
                conn.execute(text(sql))


def get_session():
    with Session(engine) as session:
        yield session


def get_database_health() -> dict:
    revisions = _get_local_alembic_revisions()
    latest_revision = revisions[-1] if revisions else None

    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
        inspector = inspect(engine)
        tables = inspector.get_table_names()
        current_revision = None
        if "alembic_version" in tables:
            try:
                current_revision = conn.execute(text("SELECT version_num FROM alembic_version LIMIT 1")).scalar()
            except Exception:
                current_revision = None

    governance = get_database_migration_governance(
        tables=tables,
        current_revision=current_revision,
        revisions=revisions,
    )

    return {
        "status": "ok",
        "database_url": str(engine.url).split("@")[-1] if "@" in str(engine.url) else str(engine.url),
        "table_count": len(tables),
        "tables": tables,
        "alembic": governance,
    }


def get_database_migration_governance(
    *,
    tables: list[str] | None = None,
    current_revision: str | None = None,
    revisions: list[str] | None = None,
) -> dict:
    local_revisions = revisions or _get_local_alembic_revisions()
    latest_revision = local_revisions[-1] if local_revisions else None
    current_revision = _normalize_alembic_revision(current_revision, local_revisions)

    if tables is None:
        with engine.connect() as conn:
            inspector = inspect(conn)
            tables = inspector.get_table_names()
            if "alembic_version" in tables:
                try:
                    current_revision = conn.execute(text("SELECT version_num FROM alembic_version LIMIT 1")).scalar()
                    current_revision = _normalize_alembic_revision(current_revision, local_revisions)
                except Exception:
                    current_revision = None
            else:
                current_revision = None
    elif current_revision is None and "alembic_version" not in tables:
        current_revision = None

    current_index = local_revisions.index(current_revision) if current_revision in local_revisions else -1
    pending_revisions = local_revisions[current_index + 1 :] if current_index >= 0 else local_revisions

    if "alembic_version" in tables and current_revision:
        mode = "alembic"
    elif tables:
        mode = "lightweight"
    else:
        mode = "bootstrap"

    return {
        "mode": mode,
        "current_revision": current_revision,
        "latest_revision": latest_revision,
        "known_revisions": local_revisions,
        "pending_revisions": pending_revisions,
        "pending_count": len(pending_revisions) if current_revision != latest_revision else 0,
        "up_to_date": (current_revision == latest_revision) if latest_revision else None,
        "idempotent_bootstrap": True,
        "notes": {
            "alembic": "Use alembic upgrade head when alembic_version exists.",
            "lightweight": "Legacy/bootstrap databases still rely on additive startup migrations.",
        },
    }
