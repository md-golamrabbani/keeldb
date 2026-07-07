"""Single shared-password gate.

Opt-in: set KEELDB_PASSWORD on the backend to require a login. When it's unset
the app stays open (desktop / localhost convenience) — no lockout. Login checks
the password and returns a signed, expiring token (HMAC-SHA256 over an expiry,
keyed by a machine-local secret); a middleware verifies it on every request.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import time

PASSWORD = os.environ.get("KEELDB_PASSWORD", "")
TTL_SECONDS = 7 * 24 * 3600


def enabled() -> bool:
    return bool(PASSWORD)


def _secret() -> bytes:
    from .store.store import DATA_DIR
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    p = DATA_DIR / "auth_secret.bin"
    if not p.exists():
        p.write_bytes(os.urandom(32))
        p.chmod(0o600)
    return p.read_bytes()


def check_password(pw: str) -> bool:
    return bool(PASSWORD) and hmac.compare_digest(pw or "", PASSWORD)


def issue_token(ttl: int = TTL_SECONDS) -> str:
    exp = int(time.time()) + ttl
    sig = hmac.new(_secret(), str(exp).encode(), hashlib.sha256).hexdigest()
    return f"{exp}.{sig}"


def verify_token(token: str) -> bool:
    try:
        exp_s, sig = (token or "").split(".", 1)
        exp = int(exp_s)
    except (ValueError, AttributeError):
        return False
    if exp < time.time():
        return False
    expected = hmac.new(_secret(), str(exp).encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(sig, expected)
