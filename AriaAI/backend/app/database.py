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
