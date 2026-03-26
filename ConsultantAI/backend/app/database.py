from sqlmodel import SQLModel, create_engine, Session
from app.config import DATABASE_URL

engine = create_engine(
    DATABASE_URL,
    echo=False,
    pool_pre_ping=True,      # 自动检测断开的连接
    pool_size=5,             # 连接池大小
    max_overflow=10,         # 最大溢出连接数
)


def create_db():
    """建表（幂等，已存在的表跳过）"""
    SQLModel.metadata.create_all(engine)


def migrate_db():
    """已由 Alembic 接管，保留空函数兼容 main.py 调用"""
    pass


def get_session():
    with Session(engine) as session:
        yield session
