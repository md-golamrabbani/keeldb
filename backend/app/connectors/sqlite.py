"""First-class SQLite connection — point at any local .db / .sqlite / .sqlite3
file and get the full explorer experience, reads AND writes (unlike the
read-only sqlfile import source)."""
from __future__ import annotations

import time
from pathlib import Path
from typing import Any, Optional

import sqlalchemy as sa

from ..models import TestResult
from .base import Connector


class SQLiteConnector(Connector):
    def url(self) -> str:
        return f"sqlite:///{self.profile.sqlite_path}"

    def test_connection(self) -> TestResult:
        start = time.perf_counter()
        try:
            p = self.profile.sqlite_path
            if not p:
                return TestResult(ok=False, error="set the path to a SQLite database file")
            if not Path(p).exists():
                return TestResult(ok=False, error=f"file not found: {p}")
            with self.engine.connect() as conn:
                ver = conn.execute(sa.text("SELECT sqlite_version()")).scalar() or ""
                n = len(sa.inspect(self.engine).get_table_names())
            return TestResult(
                ok=True,
                server_version=f"SQLite {ver} ({n} tables)",
                latency_ms=round((time.perf_counter() - start) * 1000, 1),
            )
        except Exception as exc:
            return TestResult(ok=False, error=str(exc))

    def list_schemas(self) -> list[str]:
        return ["main"]

    def _row_estimates(self, schema: str) -> dict[str, int]:
        out: dict[str, int] = {}
        with self.engine.connect() as conn:
            for n in sa.inspect(self.engine).get_table_names():
                try:
                    out[n] = int(conn.execute(sa.text(f'SELECT COUNT(*) FROM "{n}"')).scalar() or 0)
                except Exception:
                    pass
        return out

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
        stmt = sa.insert(t).values(rows)
        if conflict_strategy == "upsert":
            stmt = stmt.prefix_with("OR REPLACE")
        elif conflict_strategy == "skip":
            stmt = stmt.prefix_with("OR IGNORE")
        with self.engine.begin() as conn:
            result = conn.execute(stmt)
        written = result.rowcount if result.rowcount is not None and result.rowcount >= 0 else len(rows)
        return {"written": written, "skipped": len(rows) - written}
