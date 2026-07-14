"""Supabase Auth (`auth.users`) enrichment — a self-contained, opt-in step.

Migrating a plain user table into Supabase's `auth.users` fails out of the box:
that table needs fields an ordinary source doesn't carry — a UUID primary key
(which has *no* database default), a bcrypt-hashed password GoTrue can verify,
and a confirmed-email timestamp. This module fills exactly those, applying one
common password (bcrypt-hashed once, reused for every user) so a whole user base
can be provisioned at once.

It is completely isolated from the normal migration path: `SupabaseAuthEnricher`
is only constructed — and `enrich()` only called — when the mapping's
`SupabaseAuthConfig.enabled` is True. Any field the row already carries (e.g. an
explicitly mapped `id` or password) is left untouched.

Note: for email/password login to work end-to-end, Supabase also wants a matching
row in `auth.identities`. That is a second table and out of scope for a
single-table push; run the identities INSERT once afterwards (see the app's
Supabase Auth help text).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

import bcrypt

from .models import SupabaseAuthConfig

# Fixed namespace so a given email always maps to the same auth.users id — makes
# re-runs idempotent (pair with the "skip"/"upsert" conflict strategy). Do not
# change this value once used, or re-runs will create duplicate users.
_AUTH_NAMESPACE = uuid.UUID("6f5a1d2e-9c74-5b83-a1f0-2b6d4e8c7a10")

# Supabase's sentinel "no instance" id used on self-hosted / cloud projects.
_INSTANCE_ID = "00000000-0000-0000-0000-000000000000"


def hash_password(plain: str) -> str:
    """Bcrypt hash compatible with GoTrue's `encrypted_password`."""
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("ascii")


class SupabaseAuthEnricher:
    """Fills the auth.users fields a source table lacks. Stateless per row; the
    common password is hashed once at construction and shared across all rows."""

    def __init__(self, cfg: SupabaseAuthConfig):
        self.cfg = cfg
        self._pw_hash = hash_password(cfg.common_password) if cfg.common_password else ""

    def enrich(self, row: dict[str, Any]) -> dict[str, Any]:
        """Add the required auth.users columns in place (only when absent) and
        return the row. Leaves anything already set by the mapping alone."""
        email = row.get(self.cfg.email_column)

        # id: no DB default on auth.users — must be supplied. Derive it from the
        # email so the same person keeps the same id across re-runs.
        if not row.get("id"):
            seed = str(email).strip().lower() if email else uuid.uuid4().hex
            row["id"] = str(uuid.uuid5(_AUTH_NAMESPACE, seed))

        # The shared password (bcrypt). Never overwrite an explicitly mapped one.
        if self._pw_hash and not row.get("encrypted_password"):
            row["encrypted_password"] = self._pw_hash

        # GoTrue expects these; set them if the mapping didn't.
        row.setdefault("instance_id", _INSTANCE_ID)
        if not row.get("aud"):
            row["aud"] = "authenticated"
        if not row.get("role"):
            row["role"] = "authenticated"

        # Confirm the email so the user can sign in right away.
        if self.cfg.confirm_email and not row.get("email_confirmed_at"):
            row["email_confirmed_at"] = datetime.now(timezone.utc)

        return row


def enricher_for(cfg: SupabaseAuthConfig) -> SupabaseAuthEnricher | None:
    """Return an enricher only when the feature is switched on, else None so the
    runner does nothing for ordinary migrations."""
    return SupabaseAuthEnricher(cfg) if cfg and cfg.enabled else None
