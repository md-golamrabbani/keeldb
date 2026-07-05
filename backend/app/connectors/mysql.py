from __future__ import annotations

from typing import Any, Optional
from urllib.parse import quote_plus

import sqlalchemy as sa
from sqlalchemy.dialects.mysql import insert as mysql_insert

from ..models import SavedConnection
from .base import Connector


class MySQLConnector(Connector):
    default_port = 3306

    def url(self) -> str:
        p = self.profile
        if p.connection_string:
            cs = p.connection_string
            if cs.startswith("mysql://"):
                cs = "mysql+pymysql://" + cs[len("mysql://"):]
            return cs
        url = (
            f"mysql+pymysql://{quote_plus(p.user)}:{quote_plus(p.password)}"
            f"@{self.effective_host}:{self.effective_port}/{p.database}"
        )
        params = dict(p.extra_params)
        if p.ssl:
            params.setdefault("ssl_verify_cert", "false")
        if params:
            url += "?" + "&".join(f"{k}={quote_plus(v)}" for k, v in params.items())
        return url

    def _row_estimates(self, schema: str) -> dict[str, int]:
        q = sa.text(
            "SELECT table_name, table_rows FROM information_schema.tables "
            "WHERE table_schema = :s"
        )
        with self.engine.connect() as conn:
            rows = conn.execute(q, {"s": schema or self.profile.database}).all()
        return {r[0]: int(r[1] or 0) for r in rows}

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
        stmt = mysql_insert(t).values(rows)
        if conflict_strategy == "upsert":
            keys = set(conflict_keys or [])
            update_cols = {
                c: stmt.inserted[c] for c in rows[0].keys() if c not in keys
            }
            # Upsert on whatever unique/PK constraint the target defines.
            stmt = stmt.on_duplicate_key_update(**update_cols) if update_cols else stmt.prefix_with("IGNORE")
        elif conflict_strategy == "skip":
            stmt = stmt.prefix_with("IGNORE")
        with self.engine.begin() as conn:
            result = conn.execute(stmt)
        written = result.rowcount if result.rowcount and result.rowcount > 0 else len(rows)
        # MySQL reports 2 per updated row for ON DUPLICATE KEY; clamp to batch size.
        written = min(written, len(rows))
        return {"written": written, "skipped": len(rows) - written}
