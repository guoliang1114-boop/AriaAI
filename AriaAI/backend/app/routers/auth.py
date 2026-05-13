"""Auth router — login, user management."""
import time
import uuid
import bcrypt
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Header, Request
from pydantic import BaseModel
from sqlmodel import Session, select

from app.config import LOGIN_RATE_LIMIT_ATTEMPTS, LOGIN_RATE_LIMIT_WINDOW_SECONDS
from app.database import get_session, engine
from app.models.db import User, UserToken
from app.services.time_utils import utc_now_naive

router = APIRouter(prefix="/auth", tags=["auth"])
_LOGIN_ATTEMPTS: dict[str, list[float]] = {}


def _fix_user_id_sequence(session: Session) -> None:
    """
    Fix PostgreSQL sequence for user.id when it falls out of sync.
    
    This happens when:
    - Data was manually inserted with explicit IDs
    - Database sequence was manually reset or fell out of sync
    - Sequence was not updated after bulk operations
    """
    # Only run for PostgreSQL
    if "postgresql" not in str(engine.url).lower():
        return
    
    try:
        # Reset sequence to the maximum id in the table
        from sqlalchemy import text
        session.exec(text("""
            SELECT setval(
                pg_get_serial_sequence('"user"', 'id'),
                COALESCE((SELECT MAX(id) FROM "user"), 0) + 1,
                false
            )
        """))
        session.commit()
    except Exception:
        # If it fails (e.g., sequence doesn't exist), ignore
        session.rollback()
        pass


def _hash(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def _verify(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


def _get_login_rate_limit_key(request: Request, email: str) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    client_ip = forwarded.split(",")[0].strip() if forwarded else ""
    if not client_ip:
        client_ip = request.client.host if request.client else "unknown"
    return f"{client_ip}:{email.lower().strip()}"


def _prune_login_attempts(now: float, attempts: list[float]) -> list[float]:
    cutoff = now - LOGIN_RATE_LIMIT_WINDOW_SECONDS
    return [attempt for attempt in attempts if attempt > cutoff]


def _ensure_login_not_rate_limited(key: str) -> None:
    now = time.time()
    attempts = _prune_login_attempts(now, _LOGIN_ATTEMPTS.get(key, []))
    _LOGIN_ATTEMPTS[key] = attempts
    if len(attempts) >= LOGIN_RATE_LIMIT_ATTEMPTS:
        retry_after = max(1, int(LOGIN_RATE_LIMIT_WINDOW_SECONDS - (now - attempts[0])))
        raise HTTPException(
            status_code=429,
            detail="Too many login attempts. Please try again later.",
            headers={"Retry-After": str(retry_after)},
        )


def _record_failed_login_attempt(key: str) -> None:
    now = time.time()
    attempts = _prune_login_attempts(now, _LOGIN_ATTEMPTS.get(key, []))
    attempts.append(now)
    _LOGIN_ATTEMPTS[key] = attempts


def _clear_failed_login_attempts(key: str) -> None:
    _LOGIN_ATTEMPTS.pop(key, None)


# ── Schemas ────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: str
    password: str


class UserOut(BaseModel):
    id: int
    email: str
    display_name: str
    is_admin: bool
    is_active: bool


class LoginResponse(BaseModel):
    token: str
    user: UserOut


class CreateUserRequest(BaseModel):
    email: str
    password: str
    display_name: str = ""
    is_admin: bool = False


class UpdateUserRequest(BaseModel):
    display_name: Optional[str] = None
    is_admin: Optional[bool] = None
    is_active: Optional[bool] = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class AdminResetPasswordRequest(BaseModel):
    new_password: str


# ── Auth dependency ────────────────────────────────────────────────────────────

def get_current_user(
    x_auth_token: Optional[str] = Header(None),
    session: Session = Depends(get_session),
) -> User:
    if not x_auth_token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    # 先检查新的 UserToken 表（多设备登录）
    user_token = session.exec(
        select(UserToken).where(UserToken.token == x_auth_token)
    ).first()
    
    if user_token:
        # 更新最后使用时间
        user_token.last_used_at = utc_now_naive()
        session.add(user_token)
        session.commit()
        
        user = session.get(User, user_token.user_id)
        if user and user.is_active:
            return user
    
    # 兼容旧版：检查 User.auth_token
    user = session.exec(
        select(User).where(User.auth_token == x_auth_token, User.is_active == True)
    ).first()
    if user:
        return user
        
    raise HTTPException(status_code=401, detail="Invalid or expired token")


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest, request: Request, session: Session = Depends(get_session)):
    rate_limit_key = _get_login_rate_limit_key(request, body.email)
    _ensure_login_not_rate_limited(rate_limit_key)

    user = session.exec(
        select(User).where(User.email == body.email.lower().strip())
    ).first()
    if not user or not _verify(body.password, user.password_hash):
        _record_failed_login_attempt(rate_limit_key)
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is disabled")
    _clear_failed_login_attempts(rate_limit_key)

    # 创建新的 token（支持多设备同时登录）
    new_token = UserToken(
        user_id=user.id,
        token=str(uuid.uuid4()),
        device_info="web",  # 可以扩展为从 user-agent 获取
    )
    session.add(new_token)
    session.commit()
    session.refresh(new_token)

    return LoginResponse(
        token=new_token.token,
        user=UserOut(
            id=user.id,
            email=user.email,
            display_name=user.display_name,
            is_admin=user.is_admin,
            is_active=user.is_active,
        ),
    )


@router.post("/logout")
def logout(
    x_auth_token: Optional[str] = Header(None),
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    # 删除当前设备的 token，不影响其他设备
    if x_auth_token:
        # 清除 token 缓存（函数内导入避免循环依赖）
        try:
            import sys
            main_module = sys.modules.get('__main__')
            if main_module and hasattr(main_module, 'invalidate_token_cache'):
                main_module.invalidate_token_cache(x_auth_token)
        except Exception:
            pass  # 缓存清除失败不影响登出
            
        user_token = session.exec(
            select(UserToken).where(UserToken.token == x_auth_token)
        ).first()
        if user_token:
            session.delete(user_token)
            session.commit()
    
    # 兼容旧版：如果使用的是旧版 token，清空 auth_token
    if current_user.auth_token == x_auth_token:
        current_user.auth_token = None
        session.add(current_user)
        session.commit()
    
    return {"ok": True}


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return UserOut(
        id=current_user.id,
        email=current_user.email,
        display_name=current_user.display_name,
        is_admin=current_user.is_admin,
        is_active=current_user.is_active,
    )


class UserSimpleOut(BaseModel):
    id: int
    display_name: str


@router.get("/users", response_model=list[UserOut])
def list_users(
    _admin: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    users = session.exec(select(User)).all()
    return [
        UserOut(
            id=u.id,
            email=u.email,
            display_name=u.display_name,
            is_admin=u.is_admin,
            is_active=u.is_active,
        )
        for u in users
    ]


@router.get("/users/simple", response_model=list[UserSimpleOut])
def list_users_simple(
    _current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Return a lightweight user list for assignment pickers."""
    users = session.exec(select(User).where(User.is_active == True)).all()
    return [UserSimpleOut(id=u.id, display_name=u.display_name) for u in users]


@router.post("/users", response_model=UserOut)
def create_user(
    body: CreateUserRequest,
    _admin: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    existing = session.exec(
        select(User).where(User.email == body.email.lower().strip())
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    # Fix sequence before creating user (PostgreSQL only)
    _fix_user_id_sequence(session)

    user = User(
        email=body.email.lower().strip(),
        display_name=body.display_name or body.email.split("@")[0],
        password_hash=_hash(body.password),
        is_admin=body.is_admin,
        is_active=True,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return UserOut(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        is_admin=user.is_admin,
        is_active=user.is_active,
    )


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    body: UpdateUserRequest,
    current_admin: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    # Prevent disabling or demoting the only active admin
    if body.is_active is False or body.is_admin is False:
        active_admins = session.exec(
            select(User).where(User.is_admin == True, User.is_active == True)
        ).all()
        if len(active_admins) == 1 and active_admins[0].id == user_id:
            raise HTTPException(status_code=400, detail="Cannot remove the last active admin")

    if body.display_name is not None:
        user.display_name = body.display_name
    if body.is_admin is not None:
        user.is_admin = body.is_admin
    if body.is_active is not None:
        user.is_active = body.is_active
        if not body.is_active:
            user.auth_token = None  # force logout
    session.add(user)
    session.commit()
    session.refresh(user)
    return UserOut(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        is_admin=user.is_admin,
        is_active=user.is_active,
    )


@router.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    current_admin: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == current_admin.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    active_admins = session.exec(
        select(User).where(User.is_admin == True, User.is_active == True)
    ).all()
    if len(active_admins) == 1 and active_admins[0].id == user_id:
        raise HTTPException(status_code=400, detail="Cannot delete the last active admin")
    session.delete(user)
    session.commit()
    return {"ok": True}


@router.post("/users/{user_id}/reset-password")
def admin_reset_password(
    user_id: int,
    body: AdminResetPasswordRequest,
    _admin: User = Depends(require_admin),
    session: Session = Depends(get_session),
):
    """Admin resets another user's password (no old password required)."""
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    user.password_hash = _hash(body.new_password)
    user.auth_token = None  # force re-login
    session.add(user)
    session.commit()
    return {"ok": True}


@router.post("/change-password")
def change_password(
    body: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    if not _verify(body.current_password, current_user.password_hash):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    current_user.password_hash = _hash(body.new_password)
    session.add(current_user)
    session.commit()
    return {"ok": True}


# ── Utility used by main.py ────────────────────────────────────────────────────

def seed_admin_user(session: Session, email: str, password: str, display_name: str = "Admin"):
    """Create the default admin if no users exist yet."""
    existing = session.exec(select(User)).first()
    if existing:
        return  # users already exist, skip
    user = User(
        email=email.lower().strip(),
        display_name=display_name,
        password_hash=_hash(password),
        is_admin=True,
        is_active=True,
    )
    session.add(user)
    session.commit()
