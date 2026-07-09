"""Auto-snapshot / undo — before destructive SQL runs, dump each affected
table to a .sql script (schema + data) so the change can be undone.

A snapshot is the existing backup format (CREATE TABLE + INSERTs); restore
drops the table and replays the script inside one transaction. Snapshots live
under DATA_DIR/snapshots with a JSON index, capped at MAX_SNAPSHOTS (oldest
pruned) and skipped for tables above MAX_ROWS to keep writes fast.
"""
from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

import sqlalchemy as sa

from .backup import backup_table
from .connectors.base import Connector
from .dbops import clean_error
from .sqlimport.parser import split_statements
from .store.store import DATA_DIR

SNAP_DIR = DATA_DIR / "snapshots"
INDEX = SNAP_DIR / "index.json"
MAX_SNAPSHOTS = 40
MAX_ROWS = 100_000

# table name after the destructive verb; quoted or bare, optionally schema-qualified
_IDENT = r"((?:[`\"\[]?[\w$]+[`\"\]]?\.)?[`\"\[]?[\w$]+[`\"\]]?)"
_PATTERNS = [
    re.compile(rf"^\s*update\s+{_IDENT}", re.I),
    re.compile(rf"^\s*delete\s+from\s+{_IDENT}", re.I),
    re.compile(rf"^\s*truncate\s+(?:table\s+)?{_IDENT}", re.I),
    re.compile(rf"^\s*alter\s+table\s+{_IDENT}", re.I),
    re.compile(rf"^\s*drop\s+table\s+(?:if\s+exists\s+)?{_IDENT}", re.I),
    re.compile(rf"^\s*replace\s+into\s+{_IDENT}", re.I),
]


def _unquote(name: str) -> str:
    part = name.split(".")[-1]
    return part.strip('`"[]')


def affected_tables(sql: str) -> list[str]:
    """Table names targeted by destructive statements (UPDATE/DELETE/TRUNCATE/
    ALTER/DROP/REPLACE). INSERT is excluded — it doesn't lose existing data."""
    found: list[str] = []
    for stmt in split_statements(sql):
        for pat in _PATTERNS:
            m = pat.match(stmt)
            if m:
                t = _unquote(m.group(1))
                if t not in found:
                    found.append(t)
    return found


def _load_index() -> list[dict[str, Any]]:
    if not INDEX.exists():
        return []
    try:
        data = json.loads(INDEX.read_text())
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _save_index(items: list[dict[str, Any]]) -> None:
    SNAP_DIR.mkdir(parents=True, exist_ok=True)
    tmp = INDEX.with_suffix(".tmp")
    tmp.write_text(json.dumps(items, indent=2, default=str))
    tmp.replace(INDEX)


def _prune(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    for old in items[MAX_SNAPSHOTS:]:
        try:
            (SNAP_DIR / f"{old['id']}.sql").unlink(missing_ok=True)
        except Exception:
            pass
    return items[:MAX_SNAPSHOTS]


def snapshot_for_sql(connector: Connector, conn_id: str, schema: str, sql: str) -> Optional[dict[str, Any]]:
    """Snapshot every table a destructive statement targets. Returns snapshot
    metadata, or None when nothing destructive / nothing snapshottable."""
    tables = affected_tables(sql)
    if not tables:
        return None
    insp = sa.inspect(connector.engine)
    existing = set(insp.get_table_names(schema=schema or None))
    parts: list[str] = []
    saved: list[dict[str, Any]] = []
    skipped: list[dict[str, str]] = []
    for t in tables:
        if t not in existing:
            skipped.append({"table": t, "reason": "table not found"})
            continue
        try:
            n = connector.count_rows(schema, t, "")
            if n > MAX_ROWS:
                skipped.append({"table": t, "reason": f"{n:,} rows exceeds snapshot cap ({MAX_ROWS:,})"})
                continue
            b = backup_table(connector, schema, t)
            parts.append(f"-- ---- {t} ({b['rows']} rows) ----\n{b['sql']}")
            saved.append({"table": t, "rows": b["rows"]})
        except Exception as exc:
            skipped.append({"table": t, "reason": clean_error(exc)})
    if not saved:
        return {"id": "", "tables": [], "skipped": skipped} if skipped else None

    snap_id = uuid.uuid4().hex
    SNAP_DIR.mkdir(parents=True, exist_ok=True)
    (SNAP_DIR / f"{snap_id}.sql").write_text("\n".join(parts))
    meta = {
        "id": snap_id,
        "conn_id": conn_id,
        "schema": schema or "",
        "tables": saved,
        "skipped": skipped,
        "sql_head": sql.strip()[:200],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    items = [meta] + _load_index()
    _save_index(_prune(items))
    return meta


def list_snapshots(conn_id: Optional[str] = None) -> list[dict[str, Any]]:
    items = _load_index()
    return [i for i in items if not conn_id or i.get("conn_id") == conn_id]


def restore(connector: Connector, snap_id: str) -> dict[str, Any]:
    """Undo: drop each snapshotted table and replay its CREATE + INSERTs in one
    transaction, restoring the exact pre-change contents."""
    meta = next((i for i in _load_index() if i.get("id") == snap_id), None)
    path = SNAP_DIR / f"{snap_id}.sql"
    if not meta or not path.exists():
        raise ValueError("snapshot not found")
    if getattr(connector.profile, "read_only", False):
        raise ValueError("This connection is read-only. Turn off read-only mode to restore a snapshot.")
    script = path.read_text()
    schema = meta.get("schema", "")
    q = connector.engine.dialect.identifier_preparer.quote
    with connector.engine.begin() as conn:
        if schema:
            from .dbops import _apply_schema
            _apply_schema(conn, connector, schema)
        for t in meta["tables"]:
            conn.execute(sa.text(f"DROP TABLE IF EXISTS {q(t['table'])}"))
        for stmt in split_statements(script):
            if stmt.strip():
                conn.execute(sa.text(stmt))
    return {"ok": True, "restored": [t["table"] for t in meta["tables"]]}


def delete(snap_id: str) -> bool:
    items = _load_index()
    kept = [i for i in items if i.get("id") != snap_id]
    if len(kept) == len(items):
        return False
    (SNAP_DIR / f"{snap_id}.sql").unlink(missing_ok=True)
    _save_index(kept)
    return True
