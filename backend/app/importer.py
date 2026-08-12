"""Run a .sql script against a live connection (e.g. a KeelDB export), streaming
per-statement progress so the UI can show a progress bar. Best-effort by
default: a failing statement is reported and skipped unless stop_on_error."""
from __future__ import annotations

from typing import Iterator, Optional

import sqlalchemy as sa

from .connectors.base import Connector
from .dbops import _apply_schema
from .sqlimport.parser import split_statements


def import_stream(connector: Connector, schema: str, sql: str,
                  stop_on_error: bool = False) -> Iterator[dict]:
    if getattr(connector.profile, "read_only", False):
        raise ValueError("This connection is read-only. Turn off read-only mode on the connection to make changes.")
    statements = [s for s in split_statements(sql) if s.strip()]
    total = len(statements)
    yield {"type": "start", "total": total}
    if total == 0:
        yield {"type": "done", "executed": 0, "failed": 0, "total": 0}
        return

    # Throttle progress events so a large dump (thousands of INSERTs) doesn't
    # flood the stream — report at most ~200 progress ticks, plus every error.
    step = max(1, total // 200)
    executed = failed = 0
    with connector.engine.connect() as conn:
        conn = conn.execution_options(isolation_level="AUTOCOMMIT")
        _apply_schema(conn, connector, schema)  # USE db / search_path
        for i, stmt in enumerate(statements, 1):
            try:
                conn.execute(sa.text(stmt))
                executed += 1
                if i % step == 0 or i == total:
                    yield {"type": "progress", "done": i, "total": total,
                           "executed": executed, "failed": failed}
            except Exception as e:  # noqa: BLE001 — report and keep going
                failed += 1
                yield {"type": "error", "done": i, "total": total,
                       "statement": stmt.strip()[:200], "message": str(e),
                       "executed": executed, "failed": failed}
                if stop_on_error:
                    break
    yield {"type": "done", "executed": executed, "failed": failed, "total": total}
