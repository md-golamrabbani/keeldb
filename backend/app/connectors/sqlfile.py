from __future__ import annotations

import time
from pathlib import Path
from typing import Any, Optional

import sqlalchemy as sa

from ..models import TestResult
from .base import Connector


class SQLFileConnector(Connector):
    """A SQL dump previously loaded into a local SQLite file, exposed as a
    read-only migration source. Behaves like any other connector for
    introspection / sampling / batched reads."""

    def url(self) -> str:
        return f"sqlite:///{self.profile.sqlite_path}"

    def test_connection(self) -> TestResult:
        start = time.perf_counter()
        try:
            if not self.profile.sqlite_path or not Path(self.profile.sqlite_path).exists():
                return TestResult(ok=False, error="imported SQL file is missing; re-upload it")
            with self.engine.connect() as conn:
                ver = conn.execute(sa.text("SELECT sqlite_version()")).scalar() or ""
            latency = (time.perf_counter() - start) * 1000
            return TestResult(
                ok=True,
                server_version=f"SQLite {ver} ({self.profile.table_count} tables imported)",
                latency_ms=round(latency, 1),
            )
        except Exception as exc:
            return TestResult(ok=False, error=str(exc))

    def list_schemas(self) -> list[str]:
        # SQLite has a single (unnamed) schema; present it as "main".
        return ["main"]

    def _row_estimates(self, schema: str) -> dict[str, int]:
        import sqlalchemy as sa

        out: dict[str, int] = {}
        with self.engine.connect() as conn:
            names = sa.inspect(self.engine).get_table_names()
            for n in names:
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
        raise NotImplementedError("A SQL-file connection is a read-only source.")
