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


# -- indexes ---------------------------------------------------------------
_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_$]*$")
_ON_DELETE = {"CASCADE", "SET NULL", "RESTRICT", "NO ACTION", "SET DEFAULT"}


def _validate_ident(name: str, what: str = "name") -> str:
    name = (name or "").strip()
    if not _IDENT_RE.match(name):
        raise ValueError(f"invalid {what}: {name!r}")
    return name


def _table_columns(connector: Connector, schema: str, table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(connector.engine).get_columns(table, schema=schema or None)}


def _check_columns(connector: Connector, schema: str, table: str, columns: list[str]) -> None:
    if not columns:
        raise ValueError("no columns given")
    known = _table_columns(connector, schema, table)
    missing = [c for c in columns if c not in known]
    if missing:
        raise ValueError(f"unknown column(s): {', '.join(missing)}")


def list_indexes(connector: Connector, schema: str, table: str) -> dict[str, Any]:
    insp = sa.inspect(connector.engine)
    sch = schema or None
    pk = insp.get_pk_constraint(table, schema=sch) or {}
    pk_cols = pk.get("constrained_columns") or []
    out = []
    if pk_cols:
        out.append({"name": pk.get("name") or "(primary key)", "columns": pk_cols,
                    "unique": True, "primary": True})
    for ix in insp.get_indexes(table, schema=sch):
        out.append({"name": ix.get("name"), "columns": ix.get("column_names") or [],
                    "unique": bool(ix.get("unique")), "primary": False})
    return {"table": table, "indexes": out}


def create_index(connector: Connector, schema: str, table: str, name: str,
                 columns: list[str], unique: bool = False) -> dict[str, Any]:
    _validate_ident(name, "index name")
    _check_columns(connector, schema, table, columns)
    cols = ", ".join(_q(connector, c) for c in columns)
    uniq = "UNIQUE " if unique else ""
    _exec(connector, f"CREATE {uniq}INDEX {_q(connector, name)} ON "
                     f"{_qualified(connector, schema, table)} ({cols})")
    return {"ok": True, "created": name}


def drop_index(connector: Connector, schema: str, table: str, name: str) -> dict[str, Any]:
    _validate_ident(name, "index name")
    if _dialect(connector) == "mysql":
        sql = f"DROP INDEX {_q(connector, name)} ON {_qualified(connector, schema, table)}"
    else:  # postgres index lives in the table's schema; sqlite ignores schema
        sql = f"DROP INDEX {_qualified(connector, schema, name)}"
    _exec(connector, sql)
    return {"ok": True, "dropped": name}


# -- constraints -----------------------------------------------------------
def list_constraints(connector: Connector, schema: str, table: str) -> dict[str, Any]:
    insp = sa.inspect(connector.engine)
    sch = schema or None
    pk = insp.get_pk_constraint(table, schema=sch) or {}
    try:
        checks = [{"name": c.get("name"), "sqltext": c.get("sqltext")}
                  for c in insp.get_check_constraints(table, schema=sch)]
    except Exception:  # some dialects/versions don't implement check reflection
        checks = []
    fks = [{
        "name": fk.get("name"),
        "columns": fk.get("constrained_columns") or [],
        "ref_table": fk.get("referred_table"),
        "ref_columns": fk.get("referred_columns") or [],
        "on_delete": (fk.get("options") or {}).get("ondelete"),
    } for fk in insp.get_foreign_keys(table, schema=sch)]
    uniques = [{"name": u.get("name"), "columns": u.get("column_names") or []}
               for u in insp.get_unique_constraints(table, schema=sch)]
    return {
        "table": table,
        "primary_key": {"name": pk.get("name"), "columns": pk.get("constrained_columns") or []},
        "foreign_keys": fks,
        "unique": uniques,
        "checks": checks,
    }


def _no_sqlite_alter(connector: Connector) -> None:
    if _dialect(connector) == "sqlite":
        raise ValueError("SQLite cannot add or drop constraints on an existing table — "
                         "recreate the table with the constraint instead.")


def add_foreign_key(connector: Connector, schema: str, table: str, name: str,
                    columns: list[str], ref_table: str, ref_columns: list[str],
                    on_delete: str = "") -> dict[str, Any]:
    _no_sqlite_alter(connector)
    _validate_ident(name, "constraint name")
    _validate_ident(ref_table, "referenced table")
    _check_columns(connector, schema, table, columns)
    if not ref_columns or len(ref_columns) != len(columns):
        raise ValueError("referenced columns must match the number of local columns")
    on = ""
    if on_delete:
        od = on_delete.strip().upper()
        if od not in _ON_DELETE:
            raise ValueError(f"invalid ON DELETE action: {on_delete!r}")
        on = f" ON DELETE {od}"
    cols = ", ".join(_q(connector, c) for c in columns)
    rcols = ", ".join(_q(connector, c) for c in ref_columns)
    _exec(connector, f"ALTER TABLE {_qualified(connector, schema, table)} "
                     f"ADD CONSTRAINT {_q(connector, name)} FOREIGN KEY ({cols}) "
                     f"REFERENCES {_qualified(connector, schema, ref_table)} ({rcols}){on}")
    return {"ok": True, "created": name}


def add_unique(connector: Connector, schema: str, table: str, name: str,
               columns: list[str]) -> dict[str, Any]:
    _no_sqlite_alter(connector)
    _validate_ident(name, "constraint name")
    _check_columns(connector, schema, table, columns)
    cols = ", ".join(_q(connector, c) for c in columns)
    _exec(connector, f"ALTER TABLE {_qualified(connector, schema, table)} "
                     f"ADD CONSTRAINT {_q(connector, name)} UNIQUE ({cols})")
    return {"ok": True, "created": name}


def drop_constraint(connector: Connector, schema: str, table: str, name: str,
                    kind: str = "") -> dict[str, Any]:
    _no_sqlite_alter(connector)
    _validate_ident(name, "constraint name")
    tgt = _qualified(connector, schema, table)
    if _dialect(connector) == "mysql":
        k = (kind or "").lower()
        if k == "foreign_key":
            sql = f"ALTER TABLE {tgt} DROP FOREIGN KEY {_q(connector, name)}"
        elif k in ("unique", "index"):
            sql = f"ALTER TABLE {tgt} DROP INDEX {_q(connector, name)}"
        elif k == "primary_key":
            sql = f"ALTER TABLE {tgt} DROP PRIMARY KEY"
        else:
            raise ValueError("MySQL requires the constraint kind (foreign_key/unique/primary_key)")
    else:  # postgresql
        sql = f"ALTER TABLE {tgt} DROP CONSTRAINT {_q(connector, name)}"
    _exec(connector, sql)
    return {"ok": True, "dropped": name}
