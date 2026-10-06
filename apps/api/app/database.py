from __future__ import annotations

import json
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[3]
DATABASE_PATH = Path(os.getenv("HYPERFIT_DATABASE_PATH", PROJECT_ROOT / "data" / "hyperfit.db"))


def connect() -> sqlite3.Connection:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    return connection


@contextmanager
def transaction():
    connection = connect()
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def initialize_database() -> None:
    with transaction() as database:
        database.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                full_name TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('CLIENT','DOCTOR','ADMIN')),
                status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED')),
                must_change_password INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_login_at TEXT
            );

            CREATE TABLE IF NOT EXISTS doctor_profiles (
                user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
                license_number TEXT NOT NULL UNIQUE,
                specialty TEXT NOT NULL DEFAULT 'تغذية علاجية'
            );

            CREATE TABLE IF NOT EXISTS client_profiles (
                user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
                age INTEGER NOT NULL CHECK (age BETWEEN 18 AND 100),
                sex TEXT NOT NULL CHECK (sex IN ('MALE','FEMALE')),
                height_cm REAL NOT NULL CHECK (height_cm BETWEEN 100 AND 250),
                weight_kg REAL NOT NULL CHECK (weight_kg BETWEEN 25 AND 500),
                body_fat_pct REAL CHECK (body_fat_pct > 0 AND body_fat_pct < 80),
                activity_level TEXT NOT NULL CHECK (activity_level IN ('SEDENTARY','LIGHT','MODERATE','HIGH','VERY_HIGH')),
                default_goal TEXT NOT NULL CHECK (default_goal IN ('LOSS','GAIN','MAINTAIN')),
                medical_notes TEXT
            );

            CREATE TABLE IF NOT EXISTS auth_sessions (
                token_hash TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL,
                revoked_at TEXT
            );

            CREATE TABLE IF NOT EXISTS application_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                payload TEXT NOT NULL,
                version INTEGER NOT NULL DEFAULT 1,
                updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
                action TEXT NOT NULL,
                target_type TEXT NOT NULL,
                target_id TEXT,
                details TEXT,
                occurred_at TEXT NOT NULL
            );
            """
        )
        # Legacy migration: clients are now shared globally between doctors and admins.
        database.execute("DROP TABLE IF EXISTS doctor_client_assignments")
        state = database.execute("SELECT payload, version FROM application_state WHERE id = 1").fetchone()
        if state:
            payload = json.loads(state["payload"])
            plans = payload.get("plans", [])
            supported_plans = [plan for plan in plans if plan.get("status") in {"DRAFT", "ACTIVE"}]
            if len(supported_plans) != len(plans):
                payload["plans"] = supported_plans
                database.execute(
                    "UPDATE application_state SET payload = ?, version = ? WHERE id = 1",
                    (json.dumps(payload, ensure_ascii=False), state["version"] + 1),
                )


def audit(
    database: sqlite3.Connection,
    actor_user_id: str | None,
    action: str,
    target_type: str,
    target_id: str | None = None,
    details: dict | None = None,
    occurred_at: str = "",
) -> None:
    database.execute(
        """INSERT INTO audit_logs
           (actor_user_id, action, target_type, target_id, details, occurred_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (actor_user_id, action, target_type, target_id, json.dumps(details or {}), occurred_at),
    )
