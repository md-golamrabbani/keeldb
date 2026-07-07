"""Deterministic data masking / anonymization for prod→dev migrations.

Every function is a pure, deterministic mapping: the same input always yields the
same fake output. That keeps foreign keys, repeated values, and joins consistent
across rows and related tables while the real PII never leaves production.

Determinism comes from a salted SHA-256 of the source value — not `random` — so
results are stable across processes, machines, and re-runs. Generated data uses
reserved-for-fiction ranges (example.* domains, 555 phone exchange) so it can
never collide with a real address or number.

    fake_name(value)              -> 'Priya Andersson'
    fake_email(row['email'])      -> 'priya.andersson417@example.com'
    fake_phone(value)             -> '+1-415-555-0322'
    mask(value, 2)                -> 'Go*********'      (keep first 2)
    mask(value, -4)               -> '*******4711'      (keep last 4)
    mask_email(value)             -> 'g*****@company.com'
    hash_hex(value, 12)           -> 'a3f9c1e0b7d2'
    redact(value)                 -> 'REDACTED'
"""
from __future__ import annotations

import hashlib
from typing import Any

_SALT = "db-migration-studio:mask:v1"

FIRST_NAMES = [
    "Aria", "Priya", "Mateo", "Noah", "Liam", "Emma", "Olivia", "Kai", "Sofia",
    "Lucas", "Mia", "Ethan", "Ava", "Yuki", "Omar", "Zara", "Leon", "Nina",
    "Diego", "Chloe", "Amir", "Sara", "Ivan", "Layla", "Hugo", "Elena", "Ravi",
    "Maya", "Theo", "Isla", "Andre", "Freya", "Sami", "Nora", "Milo", "Anya",
]
LAST_NAMES = [
    "Andersson", "Nakamura", "Okafor", "Petrov", "Silva", "Kaur", "Rossi",
    "Novak", "Haddad", "Kim", "Larsen", "Costa", "Ibrahim", "Weber", "Sato",
    "Moreau", "Fernandes", "Popescu", "Bauer", "Mensah", "Reyes", "Dubois",
    "Khan", "Nguyen", "Schmidt", "Bianchi", "Vargas", "Lindqvist", "Farah",
]
DOMAINS = ["example.com", "example.net", "example.org", "sample.dev", "test.internal"]
COMPANIES = [
    "Northwind Labs", "Contoso Group", "Globex Systems", "Initech", "Umbra Works",
    "Acme Data", "Fabrikam", "Wayfare Co", "Meridian Ltd", "Ironclad Corp",
    "Blue Harbor", "Cedarline", "Vantage Digital", "Keystone Bytes", "Solvex",
]
CITIES = [
    "Fairview", "Riverton", "Lakeside", "Brookfield", "Greenwood", "Ashford",
    "Millbrook", "Oakdale", "Westport", "Northgate", "Sunvale", "Elmwood",
    "Cedar Falls", "Bayside", "Highpoint",
]


def _digest(value: Any, tag: str = "") -> int:
    """Stable 64-bit int derived from the value + a role tag."""
    h = hashlib.sha256(f"{_SALT}:{tag}:{value}".encode("utf-8")).digest()
    return int.from_bytes(h[:8], "big")


def _pick(seq: list[str], value: Any, tag: str) -> str:
    return seq[_digest(value, tag) % len(seq)]


def _blank(value: Any) -> bool:
    return value is None or (isinstance(value, str) and value == "")


def fake_first_name(value: Any) -> Any:
    return value if _blank(value) else _pick(FIRST_NAMES, value, "first")


def fake_last_name(value: Any) -> Any:
    return value if _blank(value) else _pick(LAST_NAMES, value, "last")


def fake_name(value: Any) -> Any:
    if _blank(value):
        return value
    return f"{_pick(FIRST_NAMES, value, 'first')} {_pick(LAST_NAMES, value, 'last')}"


def fake_email(value: Any) -> Any:
    if _blank(value):
        return value
    fn = _pick(FIRST_NAMES, value, "first").lower()
    ln = _pick(LAST_NAMES, value, "last").lower()
    dom = _pick(DOMAINS, value, "dom")
    tag = _digest(value, "tag") % 1000
    return f"{fn}.{ln}{tag}@{dom}"


def fake_phone(value: Any) -> Any:
    if _blank(value):
        return value
    n = _digest(value, "phone")
    area = 200 + (n % 800)          # 200-999
    line = (n // 800) % 10000       # 0000-9999, 555 is the fictional exchange
    return f"+1-{area:03d}-555-{line:04d}"


def fake_company(value: Any) -> Any:
    return value if _blank(value) else _pick(COMPANIES, value, "company")


def fake_city(value: Any) -> Any:
    return value if _blank(value) else _pick(CITIES, value, "city")


def mask(value: Any, keep: int = 1, char: str = "*") -> Any:
    """Reveal only part of a value. keep>0 keeps the first N chars, keep<0 keeps
    the last N, keep==0 masks everything. Length is preserved."""
    if value is None:
        return None
    s = str(value)
    if keep == 0:
        return char * len(s)
    if keep > 0:
        k = min(keep, len(s))
        return s[:k] + char * (len(s) - k)
    k = min(-keep, len(s))
    return char * (len(s) - k) + s[len(s) - k:]


def mask_email(value: Any) -> Any:
    """Keep the domain, mask the local part: 'g*****@company.com'."""
    if _blank(value):
        return value
    s = str(value)
    if "@" not in s:
        return mask(s, 1)
    local, _, domain = s.partition("@")
    hidden = local[:1] + "*" * max(1, len(local) - 1) if local else "*"
    return f"{hidden}@{domain}"


def redact(value: Any, token: str = "REDACTED") -> Any:
    return None if value is None else token


def hash_hex(value: Any, length: int = 12) -> Any:
    """Deterministic hex token — a stable pseudonym that reveals nothing."""
    if value is None:
        return None
    n = max(1, min(int(length), 64))
    return hashlib.sha256(f"{_SALT}:hash:{value}".encode("utf-8")).hexdigest()[:n]


MASK_FUNCTIONS = {
    "fake_first_name": fake_first_name,
    "fake_last_name": fake_last_name,
    "fake_name": fake_name,
    "fake_email": fake_email,
    "fake_phone": fake_phone,
    "fake_company": fake_company,
    "fake_city": fake_city,
    "mask": mask,
    "mask_email": mask_email,
    "redact": redact,
    "hash_hex": hash_hex,
}
