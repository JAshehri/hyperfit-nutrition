from __future__ import annotations

import argparse
import uuid

from app.database import initialize_database, transaction
from app.security import hash_password, now_iso, validate_password_strength


def main() -> None:
    parser = argparse.ArgumentParser(description="Create or update the HyperFit primary administrator")
    parser.add_argument("--email", default="joudali1910@gmailcom")
    parser.add_argument("--name", default="جود علي")
    parser.add_argument("--password", required=True)
    arguments = parser.parse_args()
    validate_password_strength(arguments.password)
    initialize_database()
    timestamp = now_iso()
    with transaction() as database:
        existing = database.execute("SELECT id FROM users WHERE email = ? COLLATE NOCASE", (arguments.email.lower(),)).fetchone()
        if existing:
            database.execute(
                """UPDATE users SET password_hash = ?, full_name = ?, role = 'ADMIN', status = 'ACTIVE',
                   must_change_password = 1, updated_at = ? WHERE id = ?""",
                (hash_password(arguments.password), arguments.name, timestamp, existing["id"]),
            )
            print(f"Updated administrator: {arguments.email}")
            return
        database.execute(
            """INSERT INTO users
               (id, email, password_hash, full_name, role, status, must_change_password, created_at, updated_at)
               VALUES (?, ?, ?, ?, 'ADMIN', 'ACTIVE', 1, ?, ?)""",
            (str(uuid.uuid4()), arguments.email.lower(), hash_password(arguments.password), arguments.name, timestamp, timestamp),
        )
    print(f"Created administrator: {arguments.email}")


if __name__ == "__main__":
    main()
