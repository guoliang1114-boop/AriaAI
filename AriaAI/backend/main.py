"""AriaAI FastAPI backend — entry point."""
import time
import logging
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import OperationalError

from app.config import (
    LOG_LEVEL, LOG_FORMAT, CORS_ORIGINS, CORS_ALLOW_CREDENTIALS,
    JWT_EXPIRATION_HOURS, SCHEDULER_ENABLED, SETTINGS_CACHE_TTL, validate_jwt_secret
)
from app.database import create_db, get_database_health, get_database_migration_governance, migrate_db, engine
from app.routers import chat, projects, projects_memory, projects_files, projects_briefing, knowledge, settings, skills, schedules, templates, clients, artifacts, messages, memory_operations
from app.routers import auth as auth_router
from app.routers.auth import seed_admin_user
from app.services import scheduler

# Import tools to register them
from app.tools import file_generators  # noqa: F401
from app.tools import pdf_translation  # noqa: F401
from app.routers.skills import DEFAULT_SKILLS, ensure_builtin_pro_skills
from app.services.project_core import init_default_project_folders
from sqlmodel import Session, select, SQLModel
from app.models.db import Project, Setting, Skill, ProjectFolder, User, UserToken
from app.config import JWT_SECRET  # Fallback for admin seed

# Configure logging from unified config
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL.upper(), logging.INFO),
    format=LOG_FORMAT,
    handlers=[logging.StreamHandler()]
)

APP_VERSION = "0.0.2"


def _backfill_folders():
    """Create default folders for all existing projects that have none."""
    def run_once() -> None:
        with Session(engine) as session:
            project_ids = session.exec(select(Project.id)).all()
            folder_project_ids = set(
                session.exec(select(ProjectFolder.project_id).distinct()).all()
            )
            for project_id in project_ids:
                if project_id not in folder_project_ids:
                    init_default_project_folders(session, project_id)

    try:
        run_once()
    except OperationalError:
        logging.getLogger(__name__).warning(
            "Database connection dropped during project folder backfill; retrying once.",
            exc_info=True,
        )
        engine.dispose()
        run_once()

def _patch_templates():
    """Backfill user_template for existing skills that have none."""
    template_map = {s["name"]: s["user_template"] for s in DEFAULT_SKILLS}
    with Session(engine) as session:
        for skill in session.exec(select(Skill)).all():
            if not skill.user_template and skill.name in template_map:
                skill.user_template = template_map[skill.name]
                session.add(skill)
        ensure_builtin_pro_skills(session)
        session.commit()


def _patch_runtime_llm_settings():
    """Raise legacy runtime output limits to the current long-answer baseline."""
    with Session(engine) as session:
        setting = session.get(Setting, "max_tokens")
        if not setting:
            session.add(Setting(key="max_tokens", value="8192"))
            session.commit()
            return
        try:
            current = int(setting.value)
        except (TypeError, ValueError):
            current = 0
        if current < 8192:
            setting.value = "8192"
            session.add(setting)
            session.commit()


def _fix_pg_sequences():
    """Reset all id sequences to MAX(id)+1 for PostgreSQL (prevents duplicate key errors after migrations)."""
    if "postgresql" not in str(engine.url).lower():
        return
    from sqlalchemy import text
    with engine.begin() as conn:
        for table in SQLModel.metadata.sorted_tables:
            if "id" not in table.columns:
                continue
            try:
                conn.execute(text(f"""
                    SELECT setval(
                        pg_get_serial_sequence('"{table.name}"', 'id'),
                        COALESCE((SELECT MAX(id) FROM "{table.name}"), 0) + 1,
                        false
                    )
                """))
            except Exception:
                # Ignore tables without a serial sequence
                pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    validate_jwt_secret()
    create_db()
    migrate_db()
    _fix_pg_sequences()
    _backfill_folders()
    _patch_templates()
    _patch_runtime_llm_settings()
    # Seed the first admin only when credentials are explicitly configured.
    from app.config import os as config_os  # Import os locally to avoid shadowing
    admin_email = config_os.getenv("ADMIN_EMAIL")
    admin_password = config_os.getenv("ADMIN_PASSWORD")
    if admin_email and admin_password:
        with Session(engine) as session:
            seed_admin_user(session, email=admin_email, password=admin_password, display_name="Admin")
    else:
        logging.getLogger(__name__).info(
            "ADMIN_EMAIL/ADMIN_PASSWORD not set; skipping default admin seed."
        )
    if SCHEDULER_ENABLED:
        scheduler.start()
    yield
    # Shutdown
    scheduler.shutdown()


app = FastAPI(
    title="AriaAI API",
    version=APP_VERSION,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=CORS_ALLOW_CREDENTIALS,
    expose_headers=["*"],
)

# Auth token in-memory cache: token → (user_id, expiry_timestamp)
_TOKEN_CACHE: dict[str, tuple[int, float]] = {}
_TOKEN_CACHE_TTL = int(SETTINGS_CACHE_TTL)  # Use config value (default 300s / 5min)


def _get_cached_user_id(token: str) -> Optional[int]:
    entry = _TOKEN_CACHE.get(token)
    if entry and time.time() < entry[1]:
        return entry[0]
    return None


def _cache_token(token: str, user_id: int):
    _TOKEN_CACHE[token] = (user_id, time.time() + _TOKEN_CACHE_TTL)


def invalidate_token_cache(token: str):
    _TOKEN_CACHE.pop(token, None)


# Auth middleware — protects all routes except /health and /auth/*
_PUBLIC_PATHS = {"/health", "/health/db", "/health/db/migrations", "/auth/login"}

@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    # Skip auth for preflight OPTIONS requests (handled by CORS middleware)
    if request.method == "OPTIONS":
        return await call_next(request)
    path = request.url.path
    if path in _PUBLIC_PATHS or path.startswith("/auth/"):
        return await call_next(request)
    token = request.headers.get("x-auth-token") or request.headers.get("X-Auth-Token")
    with Session(engine) as session:
        user: Optional[User] = None
        if token:
            # Fast path: check in-memory cache first
            cached_uid = _get_cached_user_id(token)
            if cached_uid is not None:
                user = session.get(User, cached_uid)
                if user and not user.is_active:
                    user = None
                    invalidate_token_cache(token)

            if user is None:
                # Slow path: check new UserToken table (multi-device)
                user_token = session.exec(
                    select(UserToken).where(UserToken.token == token)
                ).first()
                if user_token:
                    user = session.get(User, user_token.user_id)
                    if user and user.is_active:
                        _cache_token(token, user.id)
                        from datetime import datetime
                        user_token.last_used_at = datetime.utcnow()
                        session.add(user_token)
                        session.commit()
                    else:
                        user = None

                # Fallback: legacy User.auth_token
                if user is None:
                    user = session.exec(
                        select(User).where(User.auth_token == token, User.is_active == True)
                    ).first()
                    if user:
                        _cache_token(token, user.id)
        
        if not user:
            return JSONResponse(status_code=401, content={"detail": "Not authenticated"})
    return await call_next(request)

app.include_router(auth_router.router)
app.include_router(chat.router)
app.include_router(projects.router)
app.include_router(projects_memory.router, prefix="/projects")
app.include_router(projects_files.router, prefix="/projects")
app.include_router(projects_briefing.router, prefix="/projects")
app.include_router(knowledge.router)
app.include_router(settings.router)
app.include_router(skills.router)
app.include_router(schedules.router)
app.include_router(templates.router)
app.include_router(clients.router)
app.include_router(artifacts.router)
app.include_router(messages.router)
app.include_router(memory_operations.router)


@app.get("/health")
def health():
    return {"status": "ok", "service": "AriaAI", "version": APP_VERSION}


@app.get("/health/db")
def health_db():
    return get_database_health()


@app.get("/health/db/migrations")
def health_db_migrations():
    return get_database_migration_governance()
