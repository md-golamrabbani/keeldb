from __future__ import annotations

from typing import Any, Optional
from urllib.parse import quote_plus

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..models import SavedConnection
from .base import Connector
from .sanitize import sanitize_rows_for_pg


class PostgresConnector(Connector):
    """Also serves Supabase and Neon — they are Postgres with a preset
    (connection string paste + sslmode=require by default)."""

    default_port = 5432

    def url(self) -> str:
        p = self.profile
        if p.connection_string:
            cs = p.connection_string
            for prefix in ("postgres://", "postgresql://"):
                if cs.startswith(prefix):
                    cs = "postgresql+psycopg://" + cs[len(prefix):]
                    break
            if p.flavor in ("supabase", "neon") and "sslmode=" not in cs:
                cs += ("&" if "?" in cs else "?") + "sslmode=require"
            return cs
        url = (
            f"postgresql+psycopg://{quote_plus(p.user)}:{quote_plus(p.password)}"
            f"@{self.effective_host}:{self.effective_port}/{p.database}"
        )
        params = dict(p.extra_params)
        if p.ssl or p.flavor in ("supabase", "neon"):
            params.setdefault("sslmode", "require")
        if params:
            url += "?" + "&".join(f"{k}={quote_plus(v)}" for k, v in params.items())
        return url

    def _row_estimates(self, schema: str) -> dict[str, int]:
        q = sa.text(
            "SELECT relname, reltuples::bigint FROM pg_class c "
            "JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = :s AND c.relkind = 'r'"
        )
        with self.engine.connect() as conn:
            rows = conn.execute(q, {"s": schema or "public"}).all()
        return {r[0]: max(int(r[1] or 0), 0) for r in rows}

    def write_batch(
        self,
        schema: str,
        table: str,
        rows: list[dict[str, Any]],
        conflict_strategy: str = "insert",
        conflict_keys: Optional[list[str]] = None,
    ) -> dict[str, int]:
        if not rows:
            return {"written": 0, "skipped": 0}
        t = self._table(schema, table)
        # Coerce MySQL-isms (zero dates, ''-in-number/date/bool columns) that
        # Postgres would reject into NULL / proper types, keyed by target type.
        rows = sanitize_rows_for_pg(t, rows)
        stmt = pg_insert(t).values(rows)
        if conflict_strategy in ("upsert", "skip"):
            keys = conflict_keys or [c.name for c in t.primary_key.columns]
            if conflict_strategy == "upsert" and keys:
                update_cols = {
                    c: stmt.excluded[c] for c in rows[0].keys() if c not in set(keys)
                }
                if update_cols:
                    stmt = stmt.on_conflict_do_update(index_elements=keys, set_=update_cols)
                else:
                    stmt = stmt.on_conflict_do_nothing(index_elements=keys)
            else:
                stmt = (
                    stmt.on_conflict_do_nothing(index_elements=keys)
                    if keys
                    else stmt.on_conflict_do_nothing()
                )
        with self.engine.begin() as conn:
            result = conn.execute(stmt)
        written = result.rowcount if result.rowcount is not None and result.rowcount >= 0 else len(rows)
        return {"written": written, "skipped": len(rows) - written}
