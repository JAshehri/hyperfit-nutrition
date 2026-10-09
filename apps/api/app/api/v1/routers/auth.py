from __future__ import annotations

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from app.database import INTEGRITY_ERRORS, audit, connect, transaction
from app.security import (
    hash_password,
    new_session,
    now_iso,
    session_token_hash,
    validate_password_strength,
    verify_password,
)

router = APIRouter()
Role = Literal["CLIENT", "DOCTOR", "ADMIN"]


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=256)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().lower()


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class UpdateProfileRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=160)
    email: str = Field(min_length=3, max_length=254)

    @field_validator("email")
    @classmethod
    def normalize_profile_email(cls, value: str) -> str:
        return value.strip().lower()


def public_user(row: Any) -> dict:
    return {
        "id": row["id"],
        "email": row["email"],
        "full_name": row["full_name"],
        "role": row["role"],
        "status": row["status"],
        "must_change_password": bool(row["must_change_password"]),
    }


def current_user(authorization: Annotated[str | None, Header()] = None) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="يلزم تسجيل الدخول")
    token = authorization.removeprefix("Bearer ").strip()
    with connect() as database:
        row = database.execute(
            """SELECT u.* FROM auth_sessions s
               JOIN users u ON u.id = s.user_id
               WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?""",
            (session_token_hash(token), now_iso()),
        ).fetchone()
    if not row or row["status"] != "ACTIVE":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="الجلسة منتهية أو الحساب موقوف"
        )
    return public_user(row)


def require_admin(user: Annotated[dict, Depends(current_user)]) -> dict:
    if user["role"] != "ADMIN":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="هذه العملية متاحة للأدمن فقط"
        )
    return user


def require_staff(user: Annotated[dict, Depends(current_user)]) -> dict:
    if user["role"] not in {"DOCTOR", "ADMIN"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="هذه العملية متاحة للطبيب أو الأدمن فقط"
        )
    return user


@router.post("/login")
def login(payload: LoginRequest) -> dict:
    with transaction() as database:
        row = database.execute(
            "SELECT * FROM users WHERE email = ? COLLATE NOCASE", (payload.email,)
        ).fetchone()
        if not row or not verify_password(payload.password, row["password_hash"]):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="البريد الإلكتروني أو كلمة المرور غير صحيحة",
            )
        if row["status"] != "ACTIVE":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="الحساب موقوف")
        token, token_hash, expires_at = new_session()
        timestamp = now_iso()
        database.execute(
            "INSERT INTO auth_sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
            (token_hash, row["id"], expires_at, timestamp),
        )
        database.execute(
            "UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?",
            (timestamp, timestamp, row["id"]),
        )
        audit(database, row["id"], "AUTH_LOGIN", "USER", row["id"], occurred_at=timestamp)
        return {
            "access_token": token,
            "token_type": "bearer",
            "expires_at": expires_at,
            "user": public_user(row),
        }


@router.get("/me")
def me(user: Annotated[dict, Depends(current_user)]) -> dict:
    if user["role"] == "CLIENT":
        with connect() as database:
            profile = database.execute(
                "SELECT * FROM client_profiles WHERE user_id = ?", (user["id"],)
            ).fetchone()
        return {"user": user, "client_profile": dict(profile) if profile else None}
    return {"user": user}


@router.patch("/me")
def update_profile(
    payload: UpdateProfileRequest, user: Annotated[dict, Depends(current_user)]
) -> dict:
    timestamp = now_iso()
    try:
        with transaction() as database:
            database.execute(
                "UPDATE users SET full_name = ?, email = ?, updated_at = ? WHERE id = ?",
                (payload.full_name.strip(), payload.email, timestamp, user["id"]),
            )
            if user["role"] == "CLIENT":
                state = database.execute(
                    "SELECT payload, version FROM application_state WHERE id = 1"
                ).fetchone()
                if state:
                    import json

                    app_data = json.loads(state["payload"])
                    for client in app_data.get("clients", []):
                        if (
                            client.get("email", "").lower() == user["email"].lower()
                            or client.get("id") == user["id"]
                        ):
                            client["name"] = payload.full_name.strip()
                            client["email"] = payload.email
                    database.execute(
                        "UPDATE application_state SET payload = ?, version = ?, updated_by = ?, updated_at = ? WHERE id = 1",
                        (
                            json.dumps(app_data, ensure_ascii=False),
                            state["version"] + 1,
                            user["id"],
                            timestamp,
                        ),
                    )
            audit(
                database, user["id"], "PROFILE_UPDATED", "USER", user["id"], occurred_at=timestamp
            )
            row = database.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
    except INTEGRITY_ERRORS as error:
        raise HTTPException(status_code=409, detail="البريد الإلكتروني مستخدم لحساب آخر") from error
    return public_user(row)


@router.post("/logout", status_code=204)
def logout(
    user: Annotated[dict, Depends(current_user)],
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    token = (authorization or "").removeprefix("Bearer ").strip()
    with transaction() as database:
        timestamp = now_iso()
        database.execute(
            "UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ?",
            (timestamp, session_token_hash(token)),
        )
        audit(database, user["id"], "AUTH_LOGOUT", "USER", user["id"], occurred_at=timestamp)


@router.post("/change-password", status_code=204)
def change_password(
    payload: ChangePasswordRequest, user: Annotated[dict, Depends(current_user)]
) -> None:
    try:
        validate_password_strength(payload.new_password)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    with transaction() as database:
        row = database.execute(
            "SELECT password_hash FROM users WHERE id = ?", (user["id"],)
        ).fetchone()
        if not row or not verify_password(payload.current_password, row["password_hash"]):
            raise HTTPException(status_code=400, detail="كلمة المرور الحالية غير صحيحة")
        timestamp = now_iso()
        database.execute(
            "UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?",
            (hash_password(payload.new_password), timestamp, user["id"]),
        )
        database.execute(
            "UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ?", (timestamp, user["id"])
        )
        audit(database, user["id"], "PASSWORD_CHANGED", "USER", user["id"], occurred_at=timestamp)
