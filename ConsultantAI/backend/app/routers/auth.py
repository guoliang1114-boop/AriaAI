"""Auth router — login, user management."""
import uuid
import bcrypt
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel
from sqlmodel import Session, select

from app.database import get_session
from app.models.db import User

router = APIRouter(prefix="/auth", tags=["auth"])


def _hash(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def _verify(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


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
    user = session.exec(
        select(User).where(User.auth_token == x_auth_token, User.is_active == True)
    ).first()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest, session: Session = Depends(get_session)):
    user = session.exec(
        select(User).where(User.email == body.email.lower().strip())
    ).first()
    if not user or not _verify(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is disabled")

    # Issue a new token on each login
    user.auth_token = str(uuid.uuid4())
    session.add(user)
    session.commit()
    session.refresh(user)

    return LoginResponse(
        token=user.auth_token,
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
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
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
