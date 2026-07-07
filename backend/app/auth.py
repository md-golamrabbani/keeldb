"""Local app-unlock password (desktop-first) with security-question recovery.

First launch: the user sets a password AND a security question/answer. Every
launch requires the password. If they forget it, they can reset via the security
answer — but after 3 wrong answers the app is permanently blocked.

Auth is ON by default (single-user desktop). Escapes:
  KEELDB_AUTH_OFF=1  → disable entirely (dev/testing).
  KEELDB_PASSWORD=…  → shared-password mode (no local setup/recovery; hosted/web).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import time

_ENV_PW = os.environ.get("KEELDB_PASSWORD", "")
_OFF = os.environ.get("KEELDB_AUTH_OFF", "") == "1"
TTL_SECONDS = 3600            # 1-hour session; refreshed on activity
MAX_RECOVERY_ATTEMPTS = 3     # wrong security answers before permanent block


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


def _hash(value: str, salt: bytes) -> str:
    return hashlib.scrypt(value.encode(), salt=salt, n=16384, r=8, p=1, dklen=32).hex()


def _norm(s: str) -> str:
    return (s or "").strip().lower()


def _load() -> dict:
    f = _pw_file()
    return json.loads(f.read_text()) if f.exists() else {}


def _save(d: dict) -> None:
    f = _pw_file()
    f.write_text(json.dumps(d))
    f.chmod(0o600)


# ---- state ---------------------------------------------------------------
def is_configured() -> bool:
    return bool(_ENV_PW) or _pw_file().exists()


def needs_setup() -> bool:
    return enabled() and not is_configured()


def is_blocked() -> bool:
    return bool(_load().get("blocked"))


def security_question() -> str:
    return _load().get("question", "")


# ---- setup / verify ------------------------------------------------------
def setup(password: str, question: str, answer: str) -> None:
    if not password:
        raise ValueError("password required")
    if not (question or "").strip() or not (answer or "").strip():
        raise ValueError("security question and answer required")
    if is_configured():
        raise ValueError("a password is already set")
    psalt, asalt = os.urandom(16), os.urandom(16)
    _save({
        "salt": psalt.hex(), "hash": _hash(password, psalt),
        "question": question.strip(),
        "ans_salt": asalt.hex(), "ans_hash": _hash(_norm(answer), asalt),
        "recovery_attempts": 0, "blocked": False,
    })


def check_password(pw: str) -> bool:
    if _ENV_PW:
        return hmac.compare_digest(pw or "", _ENV_PW)
    d = _load()
    if not d:
        return False
    return hmac.compare_digest(_hash(pw or "", bytes.fromhex(d["salt"])), d["hash"])


def recover(answer: str, new_password: str) -> dict:
    """Reset the password using the security answer. Returns {ok, blocked,
    attempts_left}. Wrong answers count toward a permanent block."""
    if _ENV_PW:
        raise ValueError("recovery is not available in shared-password mode")
    d = _load()
    if not d:
        raise ValueError("no password is set")
    if d.get("blocked"):
        return {"ok": False, "blocked": True, "attempts_left": 0}
    if hmac.compare_digest(_hash(_norm(answer), bytes.fromhex(d["ans_salt"])), d["ans_hash"]):
        if not new_password:
            raise ValueError("new password required")
        psalt = os.urandom(16)
        d["salt"], d["hash"] = psalt.hex(), _hash(new_password, psalt)
        d["recovery_attempts"] = 0
        _save(d)
        return {"ok": True, "blocked": False, "attempts_left": MAX_RECOVERY_ATTEMPTS}
    d["recovery_attempts"] = int(d.get("recovery_attempts", 0)) + 1
    if d["recovery_attempts"] >= MAX_RECOVERY_ATTEMPTS:
        d["blocked"] = True
    _save(d)
    return {"ok": False, "blocked": bool(d.get("blocked")),
            "attempts_left": max(0, MAX_RECOVERY_ATTEMPTS - d["recovery_attempts"])}


# ---- tokens --------------------------------------------------------------
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
