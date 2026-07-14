#!/usr/bin/env python3
"""Create Supabase Auth users from your MySQL 'admin_user_info' table.

This is the CORRECT way to load users into Supabase Auth: the Admin API creates
the id, bcrypt-hashes the password, makes the auth.identities row, and confirms
the email — all in one call. It does NOT go through the app's "Run push", and it
does NOT insert into auth.users directly (that is what was failing).

The MySQL side is pre-filled and read straight from your saved "Dev HRIS"
connection, so you only fill in TWO Supabase values below.

RUN IT LIKE THIS (from the backend folder, so it can read your saved connection):
    cd "/home/golamrabbani/Golam Rabbani/Project/VisualDB/backend"
    .venv/bin/python ../scripts/create_supabase_users.py

Leave DRY_RUN = True for the first run (it only prints, creates nothing). When the
list looks right, set DRY_RUN = False and run again. Safe to re-run: existing
users are skipped.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

# Make the app package importable no matter where this is run from.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))

import sqlalchemy as sa

from app.connectors import connector_for
from app.store import connection_store

# ===================== YOU ONLY FILL THESE TWO ======================
SUPABASE_URL = "https://fkdapeqmwljxzzcmlova.supabase.co"   # your project (already filled in)
SERVICE_ROLE_KEY = "PASTE_YOUR_ROTATED_service_role_KEY_HERE"   # rotate the old one first!
DRY_RUN = True                                     # True = preview; False = actually create
# ====================================================================

# --- source (already discovered from your database; no need to change) ---
SOURCE_CONNECTION_NAME = "Dev HRIS"
SOURCE_SCHEMA = "hris123XXXX"
SOURCE_TABLE = "admin_user_info"
EMAIL_COLUMN = "email"

# --- password rule: email prefix (khalid.pervez@x -> "khalid.pervez") ---
PASSWORD_MODE = "email_prefix"     # or "common"
COMMON_PASSWORD = "Welcome@123"
MIN_PASSWORD_LEN = 6               # Supabase rejects shorter; short prefixes get "@2024"


def password_for(email: str) -> str:
    if PASSWORD_MODE == "common":
        return COMMON_PASSWORD
    pw = email.split("@")[0]
    return pw if len(pw) >= MIN_PASSWORD_LEN else pw + "@2024"


def fetch_emails() -> list[str]:
    conn = next((c for c in connection_store.list() if c.name == SOURCE_CONNECTION_NAME), None)
    if conn is None:
        raise SystemExit(f"No saved connection named {SOURCE_CONNECTION_NAME!r}.")
    c = connector_for(conn)
    try:
        with c.engine.connect() as cx:
            rows = cx.execute(sa.text(
                f"SELECT `{EMAIL_COLUMN}` AS email FROM `{SOURCE_SCHEMA}`.`{SOURCE_TABLE}` "
                f"WHERE `{EMAIL_COLUMN}` IS NOT NULL AND `{EMAIL_COLUMN}` <> ''"
            )).all()
    finally:
        c.dispose()
    seen, out = set(), []
    for (email,) in rows:
        e = (email or "").strip().lower()
        if e and "@" in e and e not in seen:
            seen.add(e)
            out.append(e)
    return out


def create_user(email: str) -> tuple[int, str]:
    body = json.dumps(
        {"email": email, "password": password_for(email), "email_confirm": True}
    ).encode("utf-8")
    req = urllib.request.Request(
        f"{SUPABASE_URL}/auth/v1/admin/users",
        data=body, method="POST",
        headers={
            "apikey": SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")
    except urllib.error.URLError as exc:
        return 0, str(exc)


def main() -> None:
    emails = fetch_emails()
    print(f"{len(emails)} unique users with an email.  DRY_RUN={DRY_RUN}  password={PASSWORD_MODE}")
    if DRY_RUN:
        for e in emails:
            print(f"[dry] {e}  ->  password: {password_for(e)}")
        print(f"\n(preview only — nothing created. Set DRY_RUN = False to create these {len(emails)} users.)")
        return
    if "PASTE_YOUR_ROTATED" in SERVICE_ROLE_KEY or "YOURPROJECT" in SUPABASE_URL:
        raise SystemExit("Fill in SUPABASE_URL and your rotated SERVICE_ROLE_KEY first.")
    created = skipped = failed = 0
    for i, email in enumerate(emails, 1):
        status, text = create_user(email)
        if status in (200, 201):
            created += 1
        elif status in (409, 422) and "already" in text.lower():
            skipped += 1
        else:
            failed += 1
            print(f"  FAIL {email}: {status} {text[:140]}")
        if i % 25 == 0:
            print(f"  {i}/{len(emails)}  created={created} skipped={skipped} failed={failed}")
        time.sleep(0.05)
    print(f"Done. created={created} skipped={skipped} failed={failed}")


if __name__ == "__main__":
    main()
