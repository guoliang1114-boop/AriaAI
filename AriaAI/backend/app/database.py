from sqlalchemy import inspect, text
from sqlalchemy.dialects import sqlite
from sqlmodel import SQLModel, create_engine, Session
from app.config import DATABASE_URL

engine_kwargs = {
    "echo": False,
}

if DATABASE_URL.startswith("sqlite"):
    engine_kwargs["connect_args"] = {"check_same_thread": False}
else:
    engine_kwargs.update(
        pool_size=10,            # 增加连接池大小
        max_overflow=10,         # 增加溢出连接数
        pool_recycle=300,        # 5 分钟回收一次，避免连接超时
        pool_timeout=60,         # 增加等待连接超时时间
        pool_pre_ping=True,      # 启用连接健康检查
    )

engine = create_engine(DATABASE_URL, **engine_kwargs)


def create_db():
    """建表（幂等，已存在的表跳过）"""
    SQLModel.metadata.create_all(engine)


def migrate_db():
    """Lightweight additive migrations for local SQLite dev DBs."""
    if not DATABASE_URL.startswith("sqlite"):
        return

    def _sqlite_type(column) -> str:
        return column.type.compile(dialect=sqlite.dialect())

    def _default_sql(column):
        if column.server_default is not None and hasattr(column.server_default, "arg"):
            arg = column.server_default.arg
            if isinstance(arg, str):
                return f"'{arg}'"
            return str(arg)

        if column.default is not None and getattr(column.default, "is_scalar", False):
            value = column.default.arg
            if isinstance(value, bool):
                return "1" if value else "0"
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
                if column.name in existing_columns:
                    continue
                if column.primary_key:
                    continue

                sql = f"ALTER TABLE {table.name} ADD COLUMN {column.name} {_sqlite_type(column)}"
                default_sql = _default_sql(column)
                if default_sql is not None:
                    sql += f" DEFAULT {default_sql}"
                if not column.nullable and default_sql is not None:
                    sql += " NOT NULL"
                conn.execute(text(sql))


def get_session():
    with Session(engine) as session:
        yield session
