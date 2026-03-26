"""ConsultantAI FastAPI backend — entry point."""
import os
import logging
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.database import create_db, migrate_db, engine
from app.routers import chat, projects, knowledge, settings, skills, schedules, templates, clients, artifacts
from app.routers import auth as auth_router
from app.routers.auth import seed_admin_user
from app.services import scheduler

# Import tools to register them
from app.tools import file_generators  # noqa: F401
from app.routers.skills import DEFAULT_SKILLS
from app.routers.projects import _init_default_folders
from sqlmodel import Session, select
from app.models.db import Project, Skill, ProjectFolder, User

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler()]
)


def _backfill_folders():
    """Create default folders for all existing projects that have none."""
    with Session(engine) as session:
        all_projects = session.exec(select(Project)).all()
        for project in all_projects:
            has_folders = session.exec(
                select(ProjectFolder).where(ProjectFolder.project_id == project.id)
            ).first()
            if not has_folders:
                _init_default_folders(project.id, session)


def _patch_templates():
    """Backfill user_template for existing skills that have none."""
    template_map = {s["name"]: s["user_template"] for s in DEFAULT_SKILLS}
    with Session(engine) as session:
        for skill in session.exec(select(Skill)).all():
            if not skill.user_template and skill.name in template_map:
                skill.user_template = template_map[skill.name]
                session.add(skill)
        session.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    create_db()
    migrate_db()
    _backfill_folders()
    _patch_templates()
    # Seed default admin (only if no users exist)
    admin_email = os.getenv("ADMIN_EMAIL", "admin@d2cgo.com")
    admin_password = os.getenv("ADMIN_PASSWORD", "Admin@d2cgo")
    with Session(engine) as session:
        seed_admin_user(session, email=admin_email, password=admin_password, display_name="Admin")
    scheduler.start()
    yield
    # Shutdown
    scheduler.shutdown()


app = FastAPI(
    title="ConsultantAI API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # SwiftUI app is local
    allow_methods=["*"],
    allow_headers=["*", "X-Auth-Token"],
    expose_headers=["*"],
)

# Auth middleware — protects all routes except /health and /auth/*
_PUBLIC_PATHS = {"/health", "/auth/login"}

@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    if path in _PUBLIC_PATHS or path.startswith("/auth/"):
        return await call_next(request)
    token = request.headers.get("x-auth-token")
    with Session(engine) as session:
        user: Optional[User] = None
        if token:
            user = session.exec(
                select(User).where(User.auth_token == token, User.is_active == True)
            ).first()
        if not user:
            # Allow if no users have been created yet (first-run before seed completes)
            any_user = session.exec(select(User)).first()
            if any_user:
                return JSONResponse(status_code=401, content={"detail": "Not authenticated"})
    return await call_next(request)

app.include_router(auth_router.router)
app.include_router(chat.router)
app.include_router(projects.router)
app.include_router(knowledge.router)
app.include_router(settings.router)
app.include_router(skills.router)
app.include_router(schedules.router)
app.include_router(templates.router)
app.include_router(clients.router)
app.include_router(artifacts.router)


@app.get("/health")
def health():
    return {"status": "ok", "service": "ConsultantAI"}
