"""Database administration & DDL operations for the Explorer: create/alter/drop
tables and columns, truncate, rename, create/drop/rename databases, list
triggers and privileges, reconstruct DDL, and build a schema graph (ERD).

Identifiers are quoted with the dialect's own identifier preparer (never string
interpolation of raw names). Column *type* strings are validated against a
conservative whitelist pattern. Operations that a dialect does not support raise
a clear message rather than emitting broken SQL.
"""
from __future__ import annotations

import re
from typing import Any, Optional

import sqlalchemy as sa

from .connectors.base import Connector

TYPE_RE = re.compile(r"^[A-Za-z0-9_ ()',.]+$")


def _dialect(connector: Connector) -> str:
    return connector.engine.dialect.name  # 'mysql' | 'postgresql' | 'sqlite'


def _q(connector: Connector, name: str) -> str:
    """Safely quote an identifier for this dialect."""
    return connector.engine.dialect.identifier_preparer.quote(name)


def _qualified(connector: Connector, schema: str, table: str) -> str:
    if schema and _dialect(connector) != "sqlite":
        return f"{_q(connector, schema)}.{_q(connector, table)}"
    return _q(connector, table)


def _check_type(t: str) -> str:
    t = (t or "").strip()
    if not t or not TYPE_RE.match(t):
        raise ValueError(f"invalid column type: {t!r}")
    return t


def _exec(connector: Connector, sql: str, autocommit: bool = False) -> None:
    if getattr(connector.profile, "read_only", False):
        raise ValueError("This connection is read-only. Turn off read-only mode on the connection to make changes.")
    if autocommit:
        with connector.engine.connect() as conn:
            conn.execution_options(isolation_level="AUTOCOMMIT").execute(sa.text(sql))
    else:
        with connector.engine.begin() as conn:
            conn.execute(sa.text(sql))


# -- DDL: reconstruct + ERD ------------------------------------------------
def table_ddl(connector: Connector, schema: str, table: str) -> dict[str, Any]:
    t = connector._table(schema, table)
    ddl = str(sa.schema.CreateTable(t).compile(connector.engine)).strip()
    return {"ddl": ddl + ";"}


def schema_graph(connector: Connector, schema: str) -> dict[str, Any]:
    insp = sa.inspect(connector.engine)
    sch = schema or None
    tables = []
    relationships = []
    for name in sorted(insp.get_table_names(schema=sch)):
        pk = set(insp.get_pk_constraint(name, schema=sch).get("constrained_columns") or [])
        fk_cols: dict[str, str] = {}
        for fk in insp.get_foreign_keys(name, schema=sch):
            ref_table = fk.get("referred_table")
            ref_cols = fk.get("referred_columns") or []
            for i, col in enumerate(fk.get("constrained_columns") or []):
                fk_cols[col] = ref_table or ""
                relationships.append({
                    "from_table": name,
                    "from_column": col,
                    "to_table": ref_table,
                    "to_column": ref_cols[i] if i < len(ref_cols) else "",
                })
        cols = [
            {"name": c["name"], "type": str(c["type"]), "pk": c["name"] in pk, "fk": fk_cols.get(c["name"], "")}
            for c in insp.get_columns(name, schema=sch)
        ]
        tables.append({"name": name, "columns": cols})
    return {"tables": tables, "relationships": relationships}


# -- table operations ------------------------------------------------------
def create_table(connector: Connector, schema: str, name: str, columns: list[dict[str, Any]]) -> dict[str, Any]:
    if not name or not columns:
        raise ValueError("table name and at least one column are required")
    parts = []
    pk_cols = []
    for col in columns:
        cname = col.get("name", "").strip()
        if not cname:
            raise ValueError("every column needs a name")
        ctype = _check_type(col.get("type", "TEXT"))
        piece = f"{_q(connector, cname)} {ctype}"
        if not col.get("nullable", True):
            piece += " NOT NULL"
        parts.append(piece)
        if col.get("pk"):
            pk_cols.append(cname)
    if pk_cols:
        parts.append("PRIMARY KEY (" + ", ".join(_q(connector, c) for c in pk_cols) + ")")
    sql = f"CREATE TABLE {_qualified(connector, schema, name)} (\n  " + ",\n  ".join(parts) + "\n)"
    _exec(connector, sql)
    return {"ok": True, "sql": sql}


def drop_table(connector: Connector, schema: str, table: str) -> dict[str, Any]:
    _exec(connector, f"DROP TABLE {_qualified(connector, schema, table)}")
    return {"ok": True}


def rename_table(connector: Connector, schema: str, table: str, new_name: str) -> dict[str, Any]:
    if not new_name:
        raise ValueError("new table name required")
    d = _dialect(connector)
    src = _qualified(connector, schema, table)
    if d == "mysql":
        sql = f"RENAME TABLE {src} TO {_qualified(connector, schema, new_name)}"
    else:  # postgresql, sqlite
        sql = f"ALTER TABLE {src} RENAME TO {_q(connector, new_name)}"
    _exec(connector, sql)
    return {"ok": True}


def truncate_table(connector: Connector, schema: str, table: str) -> dict[str, Any]:
    d = _dialect(connector)
    tgt = _qualified(connector, schema, table)
    if d == "sqlite":
        _exec(connector, f"DELETE FROM {tgt}")
    else:
        _exec(connector, f"TRUNCATE TABLE {tgt}")
    return {"ok": True}


# -- column operations -----------------------------------------------------
def add_column(connector: Connector, schema: str, table: str, name: str, col_type: str,
               nullable: bool = True, default: Optional[str] = None) -> dict[str, Any]:
    if not name:
        raise ValueError("column name required")
    piece = f"{_q(connector, name)} {_check_type(col_type)}"
    if not nullable:
        piece += " NOT NULL"
    if default not in (None, ""):
        piece += f" DEFAULT {_check_type(default)}"
    _exec(connector, f"ALTER TABLE {_qualified(connector, schema, table)} ADD COLUMN {piece}")
    return {"ok": True}


def drop_column(connector: Connector, schema: str, table: str, name: str) -> dict[str, Any]:
    _exec(connector, f"ALTER TABLE {_qualified(connector, schema, table)} DROP COLUMN {_q(connector, name)}")
    return {"ok": True}


def rename_column(connector: Connector, schema: str, table: str, name: str, new_name: str) -> dict[str, Any]:
    if not new_name:
        raise ValueError("new column name required")
    _exec(connector, f"ALTER TABLE {_qualified(connector, schema, table)} "
                     f"RENAME COLUMN {_q(connector, name)} TO {_q(connector, new_name)}")
    return {"ok": True}


def modify_column(connector: Connector, schema: str, table: str, name: str, new_type: str,
                  nullable: Optional[bool] = None) -> dict[str, Any]:
    d = _dialect(connector)
    tgt = _qualified(connector, schema, table)
    typ = _check_type(new_type)
    col = _q(connector, name)
    if d == "mysql":
        null_sql = "" if nullable is None else (" NULL" if nullable else " NOT NULL")
        _exec(connector, f"ALTER TABLE {tgt} MODIFY COLUMN {col} {typ}{null_sql}")
    elif d == "postgresql":
        _exec(connector, f"ALTER TABLE {tgt} ALTER COLUMN {col} TYPE {typ}")
        if nullable is not None:
            verb = "DROP NOT NULL" if nullable else "SET NOT NULL"
            _exec(connector, f"ALTER TABLE {tgt} ALTER COLUMN {col} {verb}")
    else:
        raise ValueError("SQLite cannot change a column's type in place; recreate the table instead")
    return {"ok": True}


# -- database operations ---------------------------------------------------
def create_database(connector: Connector, name: str) -> dict[str, Any]:
    if _dialect(connector) == "sqlite":
        raise ValueError("a SQL-file (SQLite) source has no server to create databases on")
    if not name or not re.match(r"^[A-Za-z0-9_]+$", name):
        raise ValueError("database name must be alphanumeric/underscore")
    _exec(connector, f"CREATE DATABASE {_q(connector, name)}", autocommit=True)
    return {"ok": True}


def drop_database(connector: Connector, name: str) -> dict[str, Any]:
    if _dialect(connector) == "sqlite":
        raise ValueError("a SQL-file (SQLite) source has no server to drop databases on")
    if not name or not re.match(r"^[A-Za-z0-9_]+$", name):
        raise ValueError("database name must be alphanumeric/underscore")
    _exec(connector, f"DROP DATABASE {_q(connector, name)}", autocommit=True)
    return {"ok": True}


def rename_database(connector: Connector, name: str, new_name: str) -> dict[str, Any]:
    d = _dialect(connector)
    if not re.match(r"^[A-Za-z0-9_]+$", new_name or ""):
        raise ValueError("database name must be alphanumeric/underscore")
    if d == "postgresql":
        _exec(connector, f"ALTER DATABASE {_q(connector, name)} RENAME TO {_q(connector, new_name)}", autocommit=True)
        return {"ok": True}
    raise ValueError(
        "MySQL/SQLite cannot rename a database directly — "
        "create the new database and migrate the tables into it."
    )


# -- triggers & privileges -------------------------------------------------
def list_triggers(connector: Connector, schema: str) -> dict[str, Any]:
    d = _dialect(connector)
    with connector.engine.connect() as conn:
        if d == "sqlite":
            rows = conn.execute(sa.text(
                "SELECT name, tbl_name, sql FROM sqlite_master WHERE type='trigger'"
            )).all()
            cols = ["name", "table", "definition"]
        elif d == "mysql":
            rows = conn.execute(sa.text(
                "SELECT trigger_name, event_object_table, action_timing, event_manipulation "
                "FROM information_schema.triggers WHERE trigger_schema = :s"
            ), {"s": schema or connector.profile.database}).all()
            cols = ["name", "table", "timing", "event"]
        else:  # postgresql
            rows = conn.execute(sa.text(
                "SELECT trigger_name, event_object_table, action_timing, event_manipulation "
                "FROM information_schema.triggers WHERE trigger_schema = :s"
            ), {"s": schema or "public"}).all()
            cols = ["name", "table", "timing", "event"]
    return {"columns": cols, "rows": [[_j(v) for v in r] for r in rows]}


def list_privileges(connector: Connector, schema: str) -> dict[str, Any]:
    d = _dialect(connector)
    if d == "sqlite":
        return {"columns": ["info"], "rows": [["SQLite has no user/privilege system"]], "note": True}
    with connector.engine.connect() as conn:
        if d == "mysql":
            rows = conn.execute(sa.text(
                "SELECT grantee, table_schema, privilege_type, is_grantable "
                "FROM information_schema.schema_privileges ORDER BY grantee"
            )).all()
            cols = ["grantee", "schema", "privilege", "grantable"]
        else:  # postgresql
            rows = conn.execute(sa.text(
                "SELECT grantee, table_schema, table_name, privilege_type "
                "FROM information_schema.role_table_grants WHERE table_schema = :s "
                "ORDER BY grantee, table_name"
            ), {"s": schema or "public"}).all()
            cols = ["grantee", "schema", "table", "privilege"]
    return {"columns": cols, "rows": [[_j(v) for v in r] for r in rows]}


def _j(v: Any) -> Any:
    return v if v is None or isinstance(v, (str, int, float, bool)) else str(v)
