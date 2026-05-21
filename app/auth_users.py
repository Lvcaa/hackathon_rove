"""End-user JWT authentication — separate from admin Basic auth in app/auth.py."""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

import bcrypt
from fastapi import Header, HTTPException, status
from jose import JWTError, jwt
from pydantic import BaseModel

from app.database import get_db

_JWT_SECRET = os.getenv("JWT_SECRET", "commutesync-dev-secret-change-in-prod")
_ALGORITHM = "HS256"
_TOKEN_EXPIRE_DAYS = 30


class CurrentUser(BaseModel):
    id: int
    email: str
    full_name: str


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_access_token(user_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=_TOKEN_EXPIRE_DAYS)
    return jwt.encode({"sub": str(user_id), "exp": expire}, _JWT_SECRET, algorithm=_ALGORITHM)


def get_current_user(authorization: str | None = Header(default=None)) -> CurrentUser:
    """FastAPI dependency. Parses 'Bearer <token>' and returns the authenticated user."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = authorization.removeprefix("Bearer ").strip()
    try:
        payload = jwt.decode(token, _JWT_SECRET, algorithms=[_ALGORITHM])
        user_id = int(payload["sub"])
    except (JWTError, KeyError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, email, full_name FROM users WHERE id = ?", (user_id,)
        ).fetchone()
    if not row:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return CurrentUser(id=row["id"], email=row["email"], full_name=row["full_name"])
