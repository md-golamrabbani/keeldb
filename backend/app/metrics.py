"""Server metrics — a handful of live KPI tiles for the Health dashboard.

Pulled from each engine's own stats views (Postgres pg_stat_database /
pg_stat_activity, MySQL SHOW GLOBAL STATUS). SQLite is an embedded file with no
server, so it reports supported=false. Returns a flat list of tiles the UI renders.
"""
from __future__ import annotations

import sqlalchemy as sa

from .connectors.base import Connector


def _tile(key: str, label: str, value, unit: str = "") -> dict:
    return {"key": key, "label": label, "value": value, "unit": unit}


def _pg_metrics(connector: Connector) -> list[dict]:
    q = sa.text(
        "SELECT "
        "(SELECT count(*) FROM pg_stat_activity) AS conns, "
        "(SELECT count(*) FROM pg_stat_activity WHERE state = 'active') AS active, "
        "(SELECT count(*) FROM pg_stat_activity WHERE state = 'idle') AS idle, "
        "d.blks_hit, d.blks_read, d.deadlocks, "
        "pg_database_size(current_database()) AS db_size "
        "FROM pg_stat_database d WHERE d.datname = current_database()"
    )
    with connector.engine.connect() as conn:
        r = conn.execute(q).one()._mapping
    hit, read = int(r["blks_hit"] or 0), int(r["blks_read"] or 0)
    ratio = round(hit / (hit + read) * 100, 2) if (hit + read) else None
    return [
        _tile("connections", "Connections", int(r["conns"])),
        _tile("active", "Active queries", int(r["active"])),
        _tile("idle", "Idle", int(r["idle"])),
        _tile("cache_hit", "Cache hit ratio", ratio, "%"),
        _tile("deadlocks", "Deadlocks", int(r["deadlocks"] or 0)),
        _tile("db_size", "Database size", int(r["db_size"] or 0), "bytes"),
    ]


def _mysql_metrics(connector: Connector) -> list[dict]:
    with connector.engine.connect() as conn:
        status = {row[0]: row[1] for row in conn.execute(sa.text("SHOW GLOBAL STATUS"))}

    def i(k: str) -> int:
        try:
            return int(status.get(k, 0))
        except (TypeError, ValueError):
            return 0

    rr, rd = i("Innodb_buffer_pool_read_requests"), i("Innodb_buffer_pool_reads")
    ratio = round(rr / (rr + rd) * 100, 2) if (rr + rd) else None
    return [
        _tile("connections", "Connections", i("Threads_connected")),
        _tile("running", "Running threads", i("Threads_running")),
        _tile("cache_hit", "Buffer pool hit", ratio, "%"),
        _tile("uptime", "Uptime", i("Uptime"), "s"),
        _tile("questions", "Questions", i("Questions")),
        _tile("slow_queries", "Slow queries", i("Slow_queries")),
    ]


def server_metrics(connector: Connector) -> dict:
    d = connector.engine.dialect.name
    if d == "postgresql":
        metrics = _pg_metrics(connector)
    elif d == "mysql":
        metrics = _mysql_metrics(connector)
    else:
        return {"supported": False, "dialect": d, "metrics": []}
    return {"supported": True, "dialect": d, "metrics": metrics}
