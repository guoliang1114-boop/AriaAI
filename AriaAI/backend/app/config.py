"""Unified configuration module for AriaAI backend.

This is the single source of truth for all backend configuration.
Priority order:
1. Environment variables (.env file)
2. Default values defined here
"""
import os
from pathlib import Path
from typing import Optional
from dotenv import load_dotenv

BASE_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR / "data"
UPLOADS_DIR = DATA_DIR / "uploads"
DB_PATH = DATA_DIR / "ariaai.db"

# Load .env file automatically
load_dotenv(BASE_DIR / ".env")

# Ensure data directories exist
DATA_DIR.mkdir(exist_ok=True)
UPLOADS_DIR.mkdir(exist_ok=True)

# =============================================================================
# Database Configuration
# =============================================================================
DEFAULT_DATABASE_URL = "sqlite:///./data/ariaai.db"

def _normalize_database_url(raw_url: str) -> str:
    if not raw_url.startswith("sqlite:///./"):
        return raw_url
    relative_part = raw_url.removeprefix("sqlite:///./")
    return f"sqlite:///{(BASE_DIR / relative_part).resolve().as_posix()}"


DATABASE_URL = _normalize_database_url(os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL))

# =============================================================================
# Security & Authentication
# =============================================================================
KEYCHAIN_SERVICE = "AriaAI"
KEYCHAIN_KEY_CLAUDE = "claude_api_key"
KEYCHAIN_KEY_KIMI = "kimi_api_key"
KEYCHAIN_KEY_OPENAI = "openai_api_key"
KEYCHAIN_KEY_DEEPSEEK = "deepseek_api_key"
KEYCHAIN_KEY_BIGMODEL = "bigmodel_api_key"
KEYCHAIN_KEY_MIMO = "mimo_api_key"

# JWT / Token settings
DEFAULT_JWT_SECRET = "your-secret-key-change-in-production"
JWT_SECRET = os.getenv("JWT_SECRET", DEFAULT_JWT_SECRET)
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = int(os.getenv("JWT_EXPIRATION_HOURS", "24"))
LOGIN_RATE_LIMIT_ATTEMPTS = int(os.getenv("LOGIN_RATE_LIMIT_ATTEMPTS", "5"))
LOGIN_RATE_LIMIT_WINDOW_SECONDS = int(os.getenv("LOGIN_RATE_LIMIT_WINDOW_SECONDS", "300"))
ALLOW_INSECURE_JWT_SECRET = os.getenv("ALLOW_INSECURE_JWT_SECRET", "false").lower() == "true"

# =============================================================================
# LLM Provider Configuration
# =============================================================================

# Supported providers
SUPPORTED_PROVIDERS = ["claude", "kimi", "deepseek", "bigmodel", "mimo"]

# Default provider
DEFAULT_PROVIDER = os.getenv("DEFAULT_LLM_PROVIDER", "claude")

# Default models per provider
DEFAULT_MODELS = {
    "claude": "claude-sonnet-4-6",
    "kimi": "kimi-k2.6",
    "deepseek": "deepseek-v4-pro",
    "bigmodel": "glm-5.1",
    "mimo": "mimo-v2-flash",
}

# Model aliases (old names -> new names)
MODEL_ALIASES = {
    "claude-opus-4": "claude-opus-4-6",
    "claude-sonnet-4": "claude-sonnet-4-6",
    "claude-haiku-4": "claude-haiku-4-5-20251001",
    "kimi-k2.6-code-preview": "kimi-k2.6",
    "xiaomi/mimo-v2-flash": "mimo-v2-flash",
    "xiaomi/mimo-v2-pro": "mimo-v2-pro",
    "xiaomi/mimo-v2-omni": "mimo-v2-omni",
}

# =============================================================================
# Generation Settings
# =============================================================================
DEFAULT_MAX_TOKENS = int(os.getenv("DEFAULT_MAX_TOKENS", "8192"))
DEFAULT_TEMPERATURE = float(os.getenv("DEFAULT_TEMPERATURE", "0.7"))
DEFAULT_TOP_P = float(os.getenv("DEFAULT_TOP_P", "1.0"))

# =============================================================================
# RAG / Embedding Configuration
# =============================================================================
CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "800"))
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "100"))
TOP_K_RESULTS = int(os.getenv("TOP_K_RESULTS", "5"))
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "all-MiniLM-L6-v2")

# =============================================================================
# API URLs
# =============================================================================
CLAUDE_BASE_URL = os.getenv("CLAUDE_BASE_URL", "https://api.anthropic.com")
KIMI_BASE_URL = os.getenv("KIMI_BASE_URL") or os.getenv("MOONSHOT_BASE_URL") or "https://api.moonshot.cn/v1"
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
BIGMODEL_BASE_URL = os.getenv("BIGMODEL_BASE_URL", "https://open.bigmodel.cn/api/paas/v4")
MIMO_BASE_URL = os.getenv("MIMO_BASE_URL") or os.getenv("XIAOMI_MIMO_BASE_URL") or "https://api.xiaomimimo.com/v1"
MIMO_TOKEN_PLAN_BASE_URL = (
    os.getenv("MIMO_TOKEN_PLAN_BASE_URL")
    or os.getenv("XIAOMI_MIMO_TOKEN_PLAN_BASE_URL")
    or "https://token-plan-cn.xiaomimimo.com/v1"
)

# =============================================================================
# CORS Configuration
# =============================================================================
# Development: allow all origins
# Production: configure specific origins via env var
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*").split(",")
CORS_ALLOW_CREDENTIALS = os.getenv("CORS_ALLOW_CREDENTIALS", "true").lower() == "true"

# =============================================================================
# Cache Configuration
# =============================================================================
CONVERSATION_CACHE_TTL = float(os.getenv("CONVERSATION_CACHE_TTL", "20.0"))
PROJECTS_CACHE_TTL = float(os.getenv("PROJECTS_CACHE_TTL", "120.0"))
SETTINGS_CACHE_TTL = float(os.getenv("SETTINGS_CACHE_TTL", "300.0"))

# =============================================================================
# Scheduler Configuration
# =============================================================================
SCHEDULER_ENABLED = os.getenv("SCHEDULER_ENABLED", "true").lower() == "true"
MEMORY_REBUILD_DEBOUNCE_SECONDS = int(os.getenv("MEMORY_REBUILD_DEBOUNCE_SECONDS", "300"))
MEMORY_REBUILD_MAX_WORKERS = int(os.getenv("MEMORY_REBUILD_MAX_WORKERS", "2"))
PROJECT_MEMORY_REBUILD_RETRY_ATTEMPTS = int(os.getenv("PROJECT_MEMORY_REBUILD_RETRY_ATTEMPTS", "3"))
PROJECT_MEMORY_REBUILD_RETRY_BASE_DELAY_SECONDS = int(
    os.getenv("PROJECT_MEMORY_REBUILD_RETRY_BASE_DELAY_SECONDS", "30")
)
CLIENT_MEMORY_REBUILD_RETRY_ATTEMPTS = int(os.getenv("CLIENT_MEMORY_REBUILD_RETRY_ATTEMPTS", "3"))
CLIENT_MEMORY_REBUILD_RETRY_BASE_DELAY_SECONDS = int(
    os.getenv("CLIENT_MEMORY_REBUILD_RETRY_BASE_DELAY_SECONDS", "30")
)
MEMORY_SUMMARY_WARM_INTERVAL_SECONDS = int(os.getenv("MEMORY_SUMMARY_WARM_INTERVAL_SECONDS", "30"))
MEMORY_SUMMARY_WARM_DAILY_LIMIT = int(os.getenv("MEMORY_SUMMARY_WARM_DAILY_LIMIT", "200"))
MEMORY_SUMMARY_WARM_RETRY_ATTEMPTS = int(os.getenv("MEMORY_SUMMARY_WARM_RETRY_ATTEMPTS", "3"))

# =============================================================================
# Logging
# =============================================================================
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
LOG_FORMAT = os.getenv("LOG_FORMAT", "%(asctime)s - %(name)s - %(levelname)s - %(message)s")

# =============================================================================
# External Service Integration
# =============================================================================
CTOOLS_BASE_URL = os.getenv("CTOOLS_BASE_URL", "http://localhost:3001")
CTOOLS_API_TOKEN = os.getenv("CTOOLS_API_TOKEN", "")

# =============================================================================
# Feature Flags
# =============================================================================
ENABLE_BIGMODEL = os.getenv("ENABLE_BIGMODEL", "true").lower() == "true"
ENABLE_RAG = os.getenv("ENABLE_RAG", "true").lower() == "true"
ENABLE_FILE_GENERATION = os.getenv("ENABLE_FILE_GENERATION", "true").lower() == "true"
ENABLE_PDF_TRANSLATION = os.getenv("ENABLE_PDF_TRANSLATION", "true").lower() == "true"


def validate_jwt_secret(secret: Optional[str] = None) -> None:
    if ALLOW_INSECURE_JWT_SECRET:
        return

    candidate = (secret or JWT_SECRET).strip()
    insecure_values = {
        "",
        DEFAULT_JWT_SECRET,
        "secret",
        "changeme",
        "your-secret-key",
    }

    if candidate in insecure_values or len(candidate) < 32:
        raise RuntimeError(
            "Refusing to start with an insecure JWT_SECRET. Set a strong secret or explicitly enable ALLOW_INSECURE_JWT_SECRET=true for local-only use."
        )
