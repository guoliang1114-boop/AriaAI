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
DEFAULT_DATABASE_URL = "postgresql://postgres:password@localhost:5432/ariaai"

DATABASE_URL = os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)

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
    "kimi": "kimi-k3",
    "deepseek": "deepseek-v4-pro",
    "bigmodel": "glm-5.3",
    "mimo": "mimo-v2.5-flash",
}

# Model aliases (old names -> new names)
MODEL_ALIASES = {
    "claude-opus-4": "claude-opus-4-6",
    "claude-sonnet-4": "claude-sonnet-4-6",
    "claude-haiku-4": "claude-haiku-4-5-20251001",
    "kimi-k2.6": "kimi-k3",
    "kimi-k2.6-code-preview": "kimi-k3",
    "glm-5.1": "glm-5.3",
    "glm-5.2": "glm-5.3",
    "glm-4-plus": "glm-5.3",
    "mimo-v2-flash": "mimo-v2.5-flash",
    "mimo-v2-pro": "mimo-v2.5-pro",
    "mimo-v2-omni": "mimo-v2.5-omni",
    "xiaomi/mimo-v2-flash": "mimo-v2.5-flash",
    "xiaomi/mimo-v2-pro": "mimo-v2.5-pro",
    "xiaomi/mimo-v2-omni": "mimo-v2.5-omni",
    "xiaomi/mimo-v2.5-flash": "mimo-v2.5-flash",
    "xiaomi/mimo-v2.5-pro": "mimo-v2.5-pro",
    "xiaomi/mimo-v2.5-omni": "mimo-v2.5-omni",
}

# =============================================================================
# Generation Settings
# =============================================================================
DEFAULT_MAX_TOKENS = int(os.getenv("DEFAULT_MAX_TOKENS", "8192"))
DEFAULT_TEMPERATURE = float(os.getenv("DEFAULT_TEMPERATURE", "0.7"))
DEFAULT_TOP_P = float(os.getenv("DEFAULT_TOP_P", "1.0"))
DEFAULT_CONTEXT_WINDOW_TOKENS = int(os.getenv("DEFAULT_CONTEXT_WINDOW_TOKENS", "32768"))
CONTEXT_WINDOW_SAFETY_MARGIN_PERCENT = int(
    os.getenv("CONTEXT_WINDOW_SAFETY_MARGIN_PERCENT", "8")
)
CONTEXT_HISTORY_SUMMARY_TOKENS = int(os.getenv("CONTEXT_HISTORY_SUMMARY_TOKENS", "1024"))
# Model-turn retries are owned by the Agent Loop, not individual provider
# adapters. The hard clamp in ``turn_retry`` limits this to three total
# attempts even if an environment value is accidentally set much higher.
MODEL_TURN_MAX_ATTEMPTS = int(os.getenv("MODEL_TURN_MAX_ATTEMPTS", "2"))
MODEL_TURN_RETRY_BASE_DELAY_MS = int(os.getenv("MODEL_TURN_RETRY_BASE_DELAY_MS", "500"))
MODEL_TURN_RETRY_MAX_DELAY_MS = int(os.getenv("MODEL_TURN_RETRY_MAX_DELAY_MS", "5000"))
# Only explicitly declared read-only tools may share a parallel execution
# batch. The harness clamps this again so an accidental environment value
# cannot create unbounded fan-out.
TOOL_PARALLEL_MAX_CONCURRENCY = int(os.getenv("TOOL_PARALLEL_MAX_CONCURRENCY", "4"))
# One chat turn has a shared execution budget across model requests, safe
# retries, and tool batches. ``turn_budget`` applies hard clamps again so an
# accidental environment override cannot create an unbounded agent loop.
AGENT_TURN_MAX_STEPS = int(os.getenv("AGENT_TURN_MAX_STEPS", "8"))
AGENT_TURN_MAX_TOOL_CALLS = int(os.getenv("AGENT_TURN_MAX_TOOL_CALLS", "24"))
AGENT_TURN_TIMEOUT_SECONDS = float(os.getenv("AGENT_TURN_TIMEOUT_SECONDS", "600"))

# Optional absolute Skill roots, ordered from highest to lowest priority.
# The repository's bundled ``skills/`` directory is always appended as the
# lowest-priority fallback; only successfully parsed packages are publishable.
SKILL_ROOTS_RAW = os.getenv("ARIA_SKILL_ROOTS", "")
SKILL_ROOT_PATHS = tuple(
    Path(value.strip()).expanduser()
    for value in SKILL_ROOTS_RAW.split(",")
    if value.strip()
)

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
# Production: configure specific origins via CORS_ORIGINS env var (comma-separated)
# Development: set CORS_ORIGINS=http://localhost:5173 or use CORS_ORIGINS=*
# WARNING: CORS_ORIGINS=* with credentials=true is insecure; always set explicit origins in production
CORS_ORIGINS_RAW = os.getenv("CORS_ORIGINS", "")
if CORS_ORIGINS_RAW:
    CORS_ORIGINS = [o.strip() for o in CORS_ORIGINS_RAW.split(",") if o.strip()]
else:
    # Default to localhost for development; production MUST set CORS_ORIGINS explicitly
    CORS_ORIGINS = ["http://localhost:5173", "http://localhost:3000"]

CORS_ALLOW_CREDENTIALS = os.getenv("CORS_ALLOW_CREDENTIALS", "true").lower() == "true"

# =============================================================================
# Cache Configuration
# =============================================================================
CONVERSATION_CACHE_TTL = float(os.getenv("CONVERSATION_CACHE_TTL", "20.0"))
PROJECTS_CACHE_TTL = float(os.getenv("PROJECTS_CACHE_TTL", "120.0"))
SETTINGS_CACHE_TTL = float(os.getenv("SETTINGS_CACHE_TTL", "300.0"))
CHAT_RETENTION_DAYS = int(os.getenv("CHAT_RETENTION_DAYS", "7"))

# =============================================================================
# Scheduler Configuration
# =============================================================================
SCHEDULER_ENABLED = os.getenv("SCHEDULER_ENABLED", "true").lower() == "true"
MEMORY_REBUILD_DEBOUNCE_SECONDS = int(os.getenv("MEMORY_REBUILD_DEBOUNCE_SECONDS", "300"))
MEMORY_REBUILD_MAX_WORKERS = int(os.getenv("MEMORY_REBUILD_MAX_WORKERS", "2"))
KNOWLEDGE_JOB_MAX_ATTEMPTS = max(1, min(int(os.getenv("KNOWLEDGE_JOB_MAX_ATTEMPTS", "3")), 10))
KNOWLEDGE_JOB_LEASE_SECONDS = max(30, min(int(os.getenv("KNOWLEDGE_JOB_LEASE_SECONDS", "300")), 3600))
KNOWLEDGE_JOB_RETRY_BASE_SECONDS = max(1, min(int(os.getenv("KNOWLEDGE_JOB_RETRY_BASE_SECONDS", "5")), 300))
KNOWLEDGE_JOB_RETRY_MAX_SECONDS = max(
    KNOWLEDGE_JOB_RETRY_BASE_SECONDS,
    min(int(os.getenv("KNOWLEDGE_JOB_RETRY_MAX_SECONDS", "300")), 3600),
)
KNOWLEDGE_JOB_SWEEP_MINUTES = max(1, min(int(os.getenv("KNOWLEDGE_JOB_SWEEP_MINUTES", "1")), 60))
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
