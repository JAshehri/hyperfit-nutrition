from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
from datetime import UTC, datetime, timedelta


PBKDF2_ITERATIONS = 310_000


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    derived = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ITERATIONS)
    return "pbkdf2_sha256${}${}${}".format(
        PBKDF2_ITERATIONS,
        base64.urlsafe_b64encode(salt).decode(),
        base64.urlsafe_b64encode(derived).decode(),
    )


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, iterations, salt_text, digest_text = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        salt = base64.urlsafe_b64decode(salt_text)
        expected = base64.urlsafe_b64decode(digest_text)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, int(iterations))
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def new_session() -> tuple[str, str, str]:
    token = secrets.token_urlsafe(48)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    expires_at = (datetime.now(UTC) + timedelta(hours=12)).isoformat()
    return token, token_hash, expires_at


def session_token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def validate_password_strength(password: str) -> None:
    if len(password) < 12:
        raise ValueError("كلمة المرور يجب ألا تقل عن 12 خانة")
    if not any(character.isupper() for character in password):
        raise ValueError("كلمة المرور يجب أن تحتوي على حرف إنجليزي كبير")
    if not any(character.islower() for character in password):
        raise ValueError("كلمة المرور يجب أن تحتوي على حرف إنجليزي صغير")
    if not any(character.isdigit() for character in password):
        raise ValueError("كلمة المرور يجب أن تحتوي على رقم")
    if password.isalnum():
        raise ValueError("كلمة المرور يجب أن تحتوي على رمز")
