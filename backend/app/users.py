"""Database users & privileges — list users/roles, create/drop a user, and
grant/revoke schema-level privileges. MySQL and PostgreSQL only; identifiers
are validated, passwords passed as quoted literals with escaping."""
from __future__ import annotations

import re
from typing import Any

import sqlalchemy as sa

from .connectors.base import Connector

_NAME_RE = re.compile(r"^[A-Za-z0-9_.$-]+$")
_PRIV_SETS = {
    "read": {"mysql": "SELECT", "postgresql": "SELECT"},
    "write": {"mysql": "SELECT, INSERT, UPDATE, DELETE", "postgresql": "SELECT, INSERT, UPDATE, DELETE"},
    "all": {"mysql": "ALL PRIVILEGES", "postgresql": "ALL PRIVILEGES"},
}


def _dialect(connector: Connector) -> str:
    return connector.engine.dialect.name


def _check_name(n: str) -> str:
    n = (n or "").strip()
    if not n or not _NAME_RE.match(n):
        raise ValueError(f"invalid name: {n!r}")
    return n


def _ensure_writable(connector: Connector) -> None:
    if getattr(connector.profile, "read_only", False):
        raise ValueError("This connection is read-only. Turn off read-only mode to manage users.")


def _quote_literal(s: str) -> str:
    return "'" + (s or "").replace("\\", "\\\\").replace("'", "''") + "'"


def list_users(connector: Connector) -> dict[str, Any]:
    d = _dialect(connector)
    users: list[dict[str, Any]] = []
    if d == "mysql":
        q = sa.text("SELECT User AS name, Host AS host FROM mysql.user ORDER BY User, Host")
        with connector.engine.connect() as conn:
            for r in conn.execute(q).mappings():
                users.append({"name": r["name"], "host": r["host"], "superuser": None})
    elif d == "postgresql":
        q = sa.text("""
            SELECT rolname AS name, rolsuper AS superuser, rolcanlogin AS can_login
            FROM pg_roles WHERE rolname NOT LIKE 'pg\\_%' ORDER BY rolname
        """)
        with connector.engine.connect() as conn:
            for r in conn.execute(q).mappings():
                users.append({"name": r["name"], "host": "", "superuser": bool(r["superuser"]),
                              "can_login": bool(r["can_login"])})
    else:
        return {"supported": False, "users": []}
    return {"supported": True, "users": users}


def create_user(connector: Connector, name: str, password: str, host: str = "%") -> dict[str, Any]:
    _ensure_writable(connector)
    d = _dialect(connector)
    name = _check_name(name)
    if not password:
        raise ValueError("password required")
    if d == "mysql":
        host = _check_name(host or "%") if host != "%" else "%"
        sql = f"CREATE USER '{name}'@'{host}' IDENTIFIED BY {_quote_literal(password)}"
    elif d == "postgresql":
        sql = f'CREATE ROLE "{name}" LOGIN PASSWORD {_quote_literal(password)}'
    else:
        raise ValueError("user management is available for MySQL and PostgreSQL only")
    with connector.engine.connect() as conn:
        conn.execute(sa.text(sql))
        conn.commit()
    return {"ok": True}


def drop_user(connector: Connector, name: str, host: str = "%") -> dict[str, Any]:
    _ensure_writable(connector)
    d = _dialect(connector)
    name = _check_name(name)
    if d == "mysql":
        host = host or "%"
        sql = f"DROP USER '{name}'@'{host}'"
    elif d == "postgresql":
        sql = f'DROP ROLE "{name}"'
    else:
        raise ValueError("user management is available for MySQL and PostgreSQL only")
    with connector.engine.connect() as conn:
        conn.execute(sa.text(sql))
        conn.commit()
    return {"ok": True}


def grant(connector: Connector, name: str, schema: str, level: str, host: str = "%") -> dict[str, Any]:
    """Grant read / write / all on every table in a schema (database on MySQL)."""
    _ensure_writable(connector)
    d = _dialect(connector)
    name = _check_name(name)
    schema = _check_name(schema)
    if level not in _PRIV_SETS:
        raise ValueError("level must be one of: read, write, all")
    privs = _PRIV_SETS[level].get(d)
    if not privs:
        raise ValueError("user management is available for MySQL and PostgreSQL only")
    stmts: list[str] = []
    if d == "mysql":
        host = host or "%"
        stmts.append(f"GRANT {privs} ON `{schema}`.* TO '{name}'@'{host}'")
        stmts.append("FLUSH PRIVILEGES")
    else:
        stmts.append(f'GRANT USAGE ON SCHEMA "{schema}" TO "{name}"')
        stmts.append(f'GRANT {privs} ON ALL TABLES IN SCHEMA "{schema}" TO "{name}"')
    with connector.engine.connect() as conn:
        for s in stmts:
            conn.execute(sa.text(s))
        conn.commit()
    return {"ok": True, "sql": stmts}
