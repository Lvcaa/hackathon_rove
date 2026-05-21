"""User registration, login, and profile endpoints."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr

from app.auth_users import (
    CurrentUser,
    create_access_token,
    get_current_user,
    hash_password,
    verify_password,
)
from app.database import get_db

router = APIRouter(prefix="/api/auth", tags=["auth"])


class RegisterPayload(BaseModel):
    email: EmailStr
    password: str
    full_name: str


class LoginPayload(BaseModel):
    email: EmailStr
    password: str


def _user_dict(row: Any) -> dict[str, Any]:
    return {"id": row["id"], "email": row["email"], "full_name": row["full_name"]}


@router.post("/register", status_code=status.HTTP_201_CREATED)
def register(payload: RegisterPayload) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    pw_hash = hash_password(payload.password)
    with get_db() as conn:
        existing = conn.execute(
            "SELECT id FROM users WHERE email = ?", (payload.email,)
        ).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail="Email already registered")
        cur = conn.execute(
            "INSERT INTO users (email, password_hash, full_name, created_at) VALUES (?,?,?,?)",
            (payload.email, pw_hash, payload.full_name, now),
        )
        user_id = cur.lastrowid
        row = conn.execute(
            "SELECT id, email, full_name FROM users WHERE id = ?", (user_id,)
        ).fetchone()
    token = create_access_token(user_id)
    return {"token": token, "user": _user_dict(row)}


@router.post("/login")
def login(payload: LoginPayload) -> dict[str, Any]:
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, email, full_name, password_hash FROM users WHERE email = ?",
            (payload.email,),
        ).fetchone()
    if not row or not verify_password(payload.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token(row["id"])
    return {"token": token, "user": _user_dict(row)}


@router.get("/me")
def me(user: CurrentUser = Depends(get_current_user)) -> dict[str, Any]:
    return {"user": {"id": user.id, "email": user.email, "full_name": user.full_name}}
