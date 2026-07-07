"""Local app-unlock password (desktop-first).

Model: on first launch there's no password → the user *sets one up*; it's stored
locally as a scrypt hash. Every launch requires it. A successful unlock issues a
signed token with a 1-hour expiry; activity refreshes it (sliding session), so it
only lapses after ~1 hour of no use.

Auth is ON by default (this is a single-user desktop app). Escapes:
  KEELDB_AUTH_OFF=1  → disable entirely (dev/testing).
  KEELDB_PASSWORD=…  → shared-password mode (skips local setup; for hosted/web).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import time

_ENV_PW = os.environ.get("KEELDB_PASSWORD", "")
_OFF = os.environ.get("KEELDB_AUTH_OFF", "") == "1"
TTL_SECONDS = 3600  # 1-hour session; refreshed on activity


def enabled() -> bool:
    return not _OFF


def _dir():
    from .store.store import DATA_DIR
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    return DATA_DIR


def _pw_file():
    return _dir() / "auth_password.json"


def _secret() -> bytes:
    p = _dir() / "auth_secret.bin"
    if not p.exists():
        p.write_bytes(os.urandom(32))
        p.chmod(0o600)
    return p.read_bytes()


def _hash(pw: str, salt: bytes) -> str:
    return hashlib.scrypt(pw.encode(), salt=salt, n=16384, r=8, p=1, dklen=32).hex()


def is_configured() -> bool:
    return bool(_ENV_PW) or _pw_file().exists()


def needs_setup() -> bool:
    """First launch — auth on but no password chosen yet."""
    return enabled() and not is_configured()


def setup(pw: str) -> None:
    if not pw:
        raise ValueError("password required")
    if is_configured():
        raise ValueError("a password is already set")
    salt = os.urandom(16)
    f = _pw_file()
    f.write_text(json.dumps({"salt": salt.hex(), "hash": _hash(pw, salt)}))
    f.chmod(0o600)


def check_password(pw: str) -> bool:
    if _ENV_PW:
        return hmac.compare_digest(pw or "", _ENV_PW)
    f = _pw_file()
    if not f.exists():
        return False
    d = json.loads(f.read_text())
    return hmac.compare_digest(_hash(pw or "", bytes.fromhex(d["salt"])), d["hash"])


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


def token_from_header(header: str) -> str:
    return header[7:] if header[:7].lower() == "bearer " else ""
