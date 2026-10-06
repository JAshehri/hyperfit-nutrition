from __future__ import annotations

import json
import sqlite3
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, model_validator

from app.api.v1.routers.auth import require_admin, require_staff
from app.database import audit, connect, transaction
from app.security import hash_password, now_iso, validate_password_strength


router = APIRouter()


class CreateUserRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str
    full_name: str = Field(min_length=2, max_length=160)
    role: Literal["CLIENT", "DOCTOR", "ADMIN"]
    license_number: str | None = None
    specialty: str = "تغذية علاجية"
    age: int | None = Field(default=None, ge=18, le=100)
    sex: Literal["MALE", "FEMALE"] | None = None
    height_cm: float | None = Field(default=None, ge=100, le=250)
    weight_kg: float | None = Field(default=None, ge=25, le=500)
    body_fat_pct: float | None = Field(default=None, gt=0, lt=80)
    activity_level: Literal["SEDENTARY", "LIGHT", "MODERATE", "HIGH", "VERY_HIGH"] | None = None
    default_goal: Literal["LOSS", "GAIN", "MAINTAIN"] | None = None
    medical_notes: str = ""

    @model_validator(mode="after")
    def validate_role_profile(self):
        self.email = self.email.strip().lower()
        if self.role == "DOCTOR" and not self.license_number:
            raise ValueError("رقم الترخيص مطلوب للطبيب")
        if self.role == "CLIENT" and any(
            value is None
            for value in (self.age, self.sex, self.height_cm, self.weight_kg, self.activity_level, self.default_goal)
        ):
            raise ValueError("العمر والجنس والطول والوزن والنشاط والهدف مطلوبة للمستخدم")
        return self


@router.get("/users")
def list_users(admin: Annotated[dict, Depends(require_admin)]) -> list[dict]:
    with connect() as database:
        rows = database.execute(
            """SELECT u.id, u.email, u.full_name, u.role, u.status, u.must_change_password, u.created_at, u.last_login_at,
                      d.license_number, d.specialty,
                      c.age, c.sex, c.height_cm, c.weight_kg, c.body_fat_pct, c.activity_level,
                      c.default_goal, c.medical_notes
               FROM users u
               LEFT JOIN doctor_profiles d ON d.user_id = u.id
               LEFT JOIN client_profiles c ON c.user_id = u.id
               ORDER BY u.created_at DESC"""
        ).fetchall()
    return [dict(row) for row in rows]


@router.post("/users", status_code=status.HTTP_201_CREATED)
def create_user(payload: CreateUserRequest, actor: Annotated[dict, Depends(require_staff)]) -> dict:
    if actor["role"] == "DOCTOR" and payload.role != "CLIENT":
        raise HTTPException(status_code=403, detail="الطبيب يستطيع إنشاء حسابات مستخدمين فقط")
    try:
        validate_password_strength(payload.password)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    user_id = str(uuid.uuid4())
    timestamp = now_iso()
    try:
        with transaction() as database:
            database.execute(
                """INSERT INTO users
                   (id, email, password_hash, full_name, role, status, must_change_password, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, 'ACTIVE', 1, ?, ?)""",
                (user_id, payload.email, hash_password(payload.password), payload.full_name.strip(), payload.role, timestamp, timestamp),
            )
            if payload.role == "DOCTOR":
                database.execute(
                    "INSERT INTO doctor_profiles (user_id, license_number, specialty) VALUES (?, ?, ?)",
                    (user_id, payload.license_number.strip(), payload.specialty.strip()),
                )
            elif payload.role == "CLIENT":
                database.execute(
                    """INSERT INTO client_profiles
                       (user_id, age, sex, height_cm, weight_kg, body_fat_pct, activity_level, default_goal, medical_notes)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (user_id, payload.age, payload.sex, payload.height_cm, payload.weight_kg, payload.body_fat_pct,
                     payload.activity_level, payload.default_goal, payload.medical_notes.strip()),
                )
                state = database.execute("SELECT payload, version FROM application_state WHERE id = 1").fetchone()
                if state:
                    app_data = json.loads(state["payload"])
                    app_data.setdefault("clients", []).insert(0, {
                        "id": user_id,
                        "name": payload.full_name.strip(),
                        "phone": "",
                        "email": payload.email,
                        "age": payload.age,
                        "height": payload.height_cm,
                        "sex": payload.sex,
                        "weight": payload.weight_kg,
                        "bodyFat": payload.body_fat_pct or 20,
                        "activity": payload.activity_level,
                        "goal": payload.default_goal,
                        "status": "ACTIVE",
                        "joinedAt": timestamp[:10],
                        "notes": payload.medical_notes.strip(),
                    })
                    database.execute(
                        """UPDATE application_state SET payload = ?, version = ?,
                           updated_by = ?, updated_at = ? WHERE id = 1""",
                        (json.dumps(app_data, ensure_ascii=False), state["version"] + 1, actor["id"], timestamp),
                    )
            audit(database, actor["id"], "USER_CREATED", "USER", user_id, {"role": payload.role}, timestamp)
    except Exception as error:
        if "UNIQUE constraint failed" in str(error):
            raise HTTPException(status_code=409, detail="البريد أو رقم الترخيص مستخدم مسبقًا") from error
        raise
    return {"id": user_id, "email": payload.email, "full_name": payload.full_name, "role": payload.role, "status": "ACTIVE"}


@router.patch("/users/{user_id}/status")
def update_user_status(
    user_id: str,
    enabled: bool,
    admin: Annotated[dict, Depends(require_admin)],
) -> dict:
    if user_id == admin["id"] and not enabled:
        raise HTTPException(status_code=400, detail="لا يمكنك إيقاف حسابك الحالي")
    with transaction() as database:
        row = database.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="الحساب غير موجود")
        new_status = "ACTIVE" if enabled else "SUSPENDED"
        timestamp = now_iso()
        database.execute("UPDATE users SET status = ?, updated_at = ? WHERE id = ?", (new_status, timestamp, user_id))
        if not enabled:
            database.execute("UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", (timestamp, user_id))
        audit(database, admin["id"], "USER_STATUS_CHANGED", "USER", user_id, {"status": new_status}, timestamp)
    return {"id": user_id, "status": new_status}


@router.delete("/users/{user_id}", status_code=204)
def delete_user(user_id: str, admin: Annotated[dict, Depends(require_admin)]) -> None:
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="لا يمكنك حذف حسابك الحالي")
    with transaction() as database:
        row = database.execute("SELECT role, email FROM users WHERE id = ?", (user_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="الحساب غير موجود")
        if row["role"] == "ADMIN":
            count = database.execute("SELECT COUNT(*) FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE'").fetchone()[0]
            if count <= 1:
                raise HTTPException(status_code=400, detail="لا يمكن حذف آخر أدمن فعال")
        timestamp = now_iso()
        audit(database, admin["id"], "USER_DELETED", "USER", user_id, {"role": row["role"]}, timestamp)
        if row["role"] == "CLIENT":
            state = database.execute("SELECT payload, version FROM application_state WHERE id = 1").fetchone()
            if state:
                app_data = json.loads(state["payload"])
                removed_ids = {
                    client.get("id") for client in app_data.get("clients", [])
                    if client.get("email", "").lower() == row["email"].lower()
                }
                app_data["clients"] = [client for client in app_data.get("clients", []) if client.get("id") not in removed_ids]
                app_data["plans"] = [plan for plan in app_data.get("plans", []) if plan.get("clientId") not in removed_ids]
                database.execute(
                    "UPDATE application_state SET payload = ?, version = ?, updated_by = ?, updated_at = ? WHERE id = 1",
                    (json.dumps(app_data, ensure_ascii=False), state["version"] + 1, admin["id"], timestamp),
                )
        database.execute("DELETE FROM auth_sessions WHERE user_id = ?", (user_id,))
        database.execute("DELETE FROM doctor_profiles WHERE user_id = ?", (user_id,))
        database.execute("DELETE FROM client_profiles WHERE user_id = ?", (user_id,))
        database.execute("DELETE FROM users WHERE id = ?", (user_id,))

