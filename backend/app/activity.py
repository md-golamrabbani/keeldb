"""Live server activity — current sessions / running queries, and a kill switch.

Reads each engine's live view (Postgres pg_stat_activity, MySQL
information_schema.processlist) and normalizes to a common session shape. SQLite
is a single embedded file with no server sessions, so it reports supported=false.
Killing is dialect-specific (pg_terminate_backend / KILL) and validates the id.
"""
from __future__ import annotations

import sqlalchemy as sa

from .connectors.base import Connector


def _pg_sessions(connector: Connector) -> list[dict]:
    q = sa.text(
        "SELECT pid AS id, usename AS \"user\", datname AS db, state, "
        "wait_event_type AS wait, query, "
        "EXTRACT(EPOCH FROM (now() - query_start)) AS duration_s, "
        "pid = pg_backend_pid() AS is_self "
        "FROM pg_stat_activity WHERE query IS NOT NULL "
        "ORDER BY duration_s DESC NULLS LAST"
    )
    with connector.engine.connect() as conn:
        return [dict(r._mapping) for r in conn.execute(q)]


def _mysql_sessions(connector: Connector) -> list[dict]:
    q = sa.text(
        "SELECT id, user AS `user`, db, command AS state, state AS wait, "
        "info AS query, time AS duration_s, "
        "id = CONNECTION_ID() AS is_self "
        "FROM information_schema.processlist ORDER BY time DESC"
    )
    with connector.engine.connect() as conn:
        return [dict(r._mapping) for r in conn.execute(q)]


def list_activity(connector: Connector) -> dict:
    d = connector.engine.dialect.name
    if d == "postgresql":
        sessions = _pg_sessions(connector)
    elif d == "mysql":
        sessions = _mysql_sessions(connector)
    else:
        return {"supported": False, "dialect": d, "sessions": []}
    for s in sessions:
        if s.get("duration_s") is not None:
            s["duration_s"] = round(float(s["duration_s"]), 1)
        s["is_self"] = bool(s.get("is_self"))
    return {"supported": True, "dialect": d, "sessions": sessions}


def kill_session(connector: Connector, session_id: str) -> dict:
    d = connector.engine.dialect.name
    try:
        sid = int(session_id)
    except (TypeError, ValueError):
        raise ValueError("session id must be numeric")
    if d == "postgresql":
        with connector.engine.connect() as conn:
            ok = conn.execute(sa.text("SELECT pg_terminate_backend(:p)"), {"p": sid}).scalar()
        return {"ok": bool(ok), "id": sid}
    if d == "mysql":
        with connector.engine.connect() as conn:
            conn.execute(sa.text(f"KILL {sid}"))  # KILL can't bind params; id is validated int
        return {"ok": True, "id": sid}
    raise ValueError("SQLite has no server sessions to terminate")
