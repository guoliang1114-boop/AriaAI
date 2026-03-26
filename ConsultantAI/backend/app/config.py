import os
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR / "data"
UPLOADS_DIR = DATA_DIR / "uploads"
DB_PATH = DATA_DIR / "consultant.db"   # SQLite 保留，仅供数据迁移脚本使用

DATA_DIR.mkdir(exist_ok=True)
UPLOADS_DIR.mkdir(exist_ok=True)

# 优先读环境变量 DATABASE_URL，其次用默认 PG 连接
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:4LsPEyLFeaj3ZdAy@localhost/aria"
)

KEYCHAIN_SERVICE = "ConsultantAI"
KEYCHAIN_KEY_CLAUDE = "claude_api_key"

CHUNK_SIZE = 800
CHUNK_OVERLAP = 100
TOP_K_RESULTS = 5
EMBEDDING_MODEL = "all-MiniLM-L6-v2"

DEFAULT_MODEL = "claude-opus-4-6"
DEFAULT_MAX_TOKENS = 4096
