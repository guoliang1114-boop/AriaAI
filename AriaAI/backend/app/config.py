"""Unified configuration module for AriaAI backend.

This is the single source of truth for all backend configuration.
Priority order:
1. Environment variables (.env file)
2. Default values defined here
"""
import os
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR / "data"
UPLOADS_DIR = DATA_DIR / "uploads"
DB_PATH = DATA_DIR / "ariaai.db"   # SQLite for local development

# Load .env file automatically
load_dotenv(BASE_DIR / ".env")

# Ensure data directories exist
DATA_DIR.mkdir(exist_ok=True)
UPLOADS_DIR.mkdir(exist_ok=True)

# =============================================================================
# Database Configuration
# =============================================================================
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./data/ariaai.db")

# =============================================================================
# Security & Authentication
# =============================================================================
KEYCHAIN_SERVICE = "AriaAI"
KEYCHAIN_KEY_CLAUDE = "claude_api_key"
KEYCHAIN_KEY_KIMI = "kimi_api_key"
KEYCHAIN_KEY_OPENAI = "openai_api_key"
KEYCHAIN_KEY_DEEPSEEK = "deepseek_api_key"
KEYCHAIN_KEY_BIGMODEL = "bigmodel_api_key"

# JWT / Token settings
JWT_SECRET = os.getenv("JWT_SECRET", "your-secret-key-change-in-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = int(os.getenv("JWT_EXPIRATION_HOURS", "24"))

# =============================================================================
# LLM Provider Configuration
# =============================================================================

# Supported providers
SUPPORTED_PROVIDERS = ["claude", "kimi", "bigmodel"]

# Default provider
DEFAULT_PROVIDER = os.getenv("DEFAULT_LLM_PROVIDER", "claude")

# Default models per provider
DEFAULT_MODELS = {
    "claude": "claude-sonnet-4-6",
    "kimi": "moonshot-v1-128k",
    "bigmodel": "glm-5.1",
}

# Model aliases (old names -> new names)
MODEL_ALIASES = {
    "claude-opus-4": "claude-opus-4-6",
    "claude-sonnet-4": "claude-sonnet-4-6",
    "claude-haiku-4": "claude-haiku-4-5-20251001",
}

# =============================================================================
# Generation Settings
# =============================================================================
DEFAULT_MAX_TOKENS = int(os.getenv("DEFAULT_MAX_TOKENS", "4096"))
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
KIMI_BASE_URL = os.getenv("KIMI_BASE_URL", "https://api.moonshot.cn/v1")
BIGMODEL_BASE_URL = os.getenv("BIGMODEL_BASE_URL", "https://open.bigmodel.cn/api/paas/v4")

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

# =============================================================================
# Logging
# =============================================================================
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
LOG_FORMAT = os.getenv("LOG_FORMAT", "%(asctime)s - %(name)s - %(levelname)s - %(message)s")

# =============================================================================
# Feature Flags
# =============================================================================
ENABLE_BIGMODEL = os.getenv("ENABLE_BIGMODEL", "true").lower() == "true"
ENABLE_RAG = os.getenv("ENABLE_RAG", "true").lower() == "true"
ENABLE_FILE_GENERATION = os.getenv("ENABLE_FILE_GENERATION", "true").lower() == "true"
