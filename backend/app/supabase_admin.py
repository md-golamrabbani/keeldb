"""Supabase Auth Admin API client — bulk-create auth users from any table.

This is the supported way to load users into Supabase Auth: each POST to
`/auth/v1/admin/users` makes Supabase generate the id, bcrypt-hash the password,
create the `auth.identities` row, and confirm the email — everything a direct
INSERT into `auth.users` cannot do. The service_role key is supplied per call and
never stored on disk.

Pure/testable: `iter_create_users` yields NDJSON-able progress events and takes a
`create_fn` seam so tests can run without hitting the network.
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from typing import Callable, Iterator

DEFAULT_MIN_PASSWORD_LEN = 6


def normalize_base_url(url: str) -> str:
    url = (url or "").strip().rstrip("/")
    if url and not url.startswith(("http://", "https://")):
        url = "https://" + url
    return url


def password_for(email: str, mode: str, common: str,
                 min_len: int = DEFAULT_MIN_PASSWORD_LEN) -> str:
    """`common` -> everyone shares one password; otherwise the email prefix
    (`abc@x.com` -> `abc`), padded when shorter than Supabase's minimum."""
    if mode == "common":
        return common
    pw = email.split("@")[0]
    return pw if len(pw) >= min_len else pw + "@2024"


def create_user(base_url: str, key: str, email: str, password: str,
                confirm: bool = True, timeout: int = 30) -> tuple[int, str]:
    """One Admin API call. Returns (http_status, body_text). status 0 == network
    error (body holds the reason)."""
    body = json.dumps({"email": email, "password": password, "email_confirm": confirm}).encode("utf-8")
    req = urllib.request.Request(
        f"{base_url}/auth/v1/admin/users",
        data=body, method="POST",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")
    except urllib.error.URLError as exc:
        return 0, str(getattr(exc, "reason", exc))


def iter_create_users(
    base_url: str,
    key: str,
    emails: list[str],
    *,
    password_mode: str = "email_prefix",
    common_password: str = "",
    confirm: bool = True,
    dry_run: bool = True,
    sleep: float = 0.05,
    create_fn: Callable[..., tuple[int, str]] = create_user,
) -> Iterator[dict]:
    """Yield progress events while creating each user.

    Events: start / preview (dry-run only) / user_error / progress / done.
    A user that already exists counts as `skipped`, so re-running is safe."""
    base_url = normalize_base_url(base_url)
    total = len(emails)
    yield {"event": "start", "total": total, "dry_run": dry_run}
    created = skipped = failed = 0
    for i, email in enumerate(emails, 1):
        pw = password_for(email, password_mode, common_password)
        if dry_run:
            yield {"event": "preview", "email": email, "password": pw}
        else:
            status, text = create_fn(base_url, key, email, pw, confirm)
            low = text.lower()
            if status in (200, 201):
                created += 1
            elif status in (409, 422) and ("already" in low or "registered" in low or "exists" in low):
                skipped += 1
            else:
                failed += 1
                yield {"event": "user_error", "email": email, "status": status, "message": text[:200]}
            if sleep:
                time.sleep(sleep)
        yield {
            "event": "progress", "processed": i, "total": total,
            "created": created, "skipped": skipped, "failed": failed,
        }
    yield {
        "event": "done", "total": total,
        "created": created, "skipped": skipped, "failed": failed, "dry_run": dry_run,
    }
