"""Run a .sql script against a live connection (e.g. a KeelDB export), streaming
progress so the UI can show a progress bar.

Large files (multi-GB dumps) are processed **incrementally**: the caller passes a
file object, we read it in fixed chunks and split statements as they complete —
so memory stays bounded regardless of file size. Best-effort by default: a
failing statement is reported and skipped unless stop_on_error.
"""
from __future__ import annotations

import codecs
import io
from typing import BinaryIO, Iterator

import sqlalchemy as sa

from .connectors.base import Connector
from .dbops import _apply_schema
from .sqlimport.parser import split_statements

_CHUNK = 1 << 20  # 1 MiB reads


def _run_one(conn, stmt: str):
    s = stmt.strip()
    if not s:
        return True, ""
    try:
        conn.execute(sa.text(s))
        return True, ""
    except Exception as e:  # noqa: BLE001 — reported per-statement
        return False, str(e)


def import_file_stream(connector: Connector, schema: str, fh: BinaryIO,
                       total_bytes: int, stop_on_error: bool = False) -> Iterator[dict]:
    """Execute the SQL in `fh` (a binary, seekable-to-0 file) statement by
    statement, reading in chunks so a 10 GB dump never lands in memory."""
    if getattr(connector.profile, "read_only", False):
        raise ValueError("This connection is read-only. Turn off read-only mode on the connection to make changes.")
    yield {"type": "start", "bytes_total": total_bytes}
    dec = codecs.getincrementaldecoder("utf-8")(errors="replace")
    buffer = ""
    bytes_done = executed = failed = 0
    last_emit = 0
    stopped = False

    with connector.engine.connect() as conn:
        conn = conn.execution_options(isolation_level="AUTOCOMMIT")
        _apply_schema(conn, connector, schema)  # USE db / search_path

        while not stopped:
            raw = fh.read(_CHUNK)
            if not raw:
                break
            bytes_done += len(raw)
            buffer += dec.decode(raw)
            parts = list(split_statements(buffer))
            # The last element may be an incomplete statement — keep it buffered.
            buffer = parts.pop() if parts else ""
            for stmt in parts:
                ok, err = _run_one(conn, stmt)
                if ok:
                    executed += 1
                else:
                    failed += 1
                    yield {"type": "error", "statement": stmt.strip()[:200], "message": err,
                           "executed": executed, "failed": failed}
                    if stop_on_error:
                        stopped = True
                        break
            if bytes_done - last_emit >= _CHUNK:
                last_emit = bytes_done
                yield {"type": "progress", "bytes_done": bytes_done, "bytes_total": total_bytes,
                       "executed": executed, "failed": failed}

        # Flush whatever remains (the final, un-terminated statement).
        if not stopped:
            buffer += dec.decode(b"", final=True)
            for stmt in split_statements(buffer):
                ok, err = _run_one(conn, stmt)
                if ok:
                    executed += 1
                else:
                    failed += 1
                    yield {"type": "error", "statement": stmt.strip()[:200], "message": err,
                           "executed": executed, "failed": failed}
                    if stop_on_error:
                        break

    yield {"type": "done", "executed": executed, "failed": failed, "bytes_total": total_bytes}


def import_stream(connector: Connector, schema: str, sql: str,
                  stop_on_error: bool = False) -> Iterator[dict]:
    """Convenience wrapper for an in-memory SQL string."""
    data = sql.encode("utf-8")
    yield from import_file_stream(connector, schema, io.BytesIO(data), len(data), stop_on_error)
