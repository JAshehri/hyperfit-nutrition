from __future__ import annotations

import argparse
import os
import uuid

from app.database import initialize_database, transaction
from app.security import hash_password, now_iso, validate_password_strength


def ensure_administrator(
    email: str,
    name: str,
    password: str,
    *,
    update_existing: bool,
) -> str:
    """Create the primary administrator without resetting it on every restart."""
    validate_password_strength(password)
    initialize_database()
    normalized_email = email.strip().lower()
    timestamp = now_iso()
    with transaction() as database:
        existing = database.execute(
            "SELECT id FROM users WHERE email = ? COLLATE NOCASE",
            (normalized_email,),
        ).fetchone()
        if existing:
            if not update_existing:
                return "existing"
            database.execute(
                """UPDATE users SET password_hash = ?, full_name = ?, role = 'ADMIN', status = 'ACTIVE',
                   must_change_password = 1, updated_at = ? WHERE id = ?""",
                (hash_password(password), name, timestamp, existing["id"]),
            )
            return "updated"
        database.execute(
            """INSERT INTO users
               (id, email, password_hash, full_name, role, status, must_change_password, created_at, updated_at)
               VALUES (?, ?, ?, ?, 'ADMIN', 'ACTIVE', 1, ?, ?)""",
            (
                str(uuid.uuid4()),
                normalized_email,
                hash_password(password),
                name,
                timestamp,
                timestamp,
            ),
        )
    return "created"


def ensure_administrator_from_environment() -> None:
    """Bootstrap a clean deployed database once using Render secret variables."""
    email = os.getenv("HYPERFIT_ADMIN_EMAIL")
    password = os.getenv("HYPERFIT_ADMIN_PASSWORD")
    name = os.getenv("HYPERFIT_ADMIN_NAME", "HyperFit Administrator")
    if not email and not password:
        return
    if not email or not password:
        raise RuntimeError(
            "HYPERFIT_ADMIN_EMAIL and HYPERFIT_ADMIN_PASSWORD must be configured together"
        )
    ensure_administrator(email, name, password, update_existing=False)


def main() -> None:
    parser = argparse.ArgumentParser(description="Create or update the HyperFit primary administrator")
    parser.add_argument("--email", default="joudali1910@gmailcom")
    parser.add_argument("--name", default="جود علي")
    parser.add_argument("--password", required=True)
    arguments = parser.parse_args()
    result = ensure_administrator(
        arguments.email,
        arguments.name,
        arguments.password,
        update_existing=True,
    )
    print(f"{result.capitalize()} administrator: {arguments.email}")


if __name__ == "__main__":
    main()
