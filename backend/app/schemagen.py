"""Generate a target-dialect CREATE TABLE from a source table.

Removes the "target table must already exist" blocker: reflect the source table,
convert each column to a generic SQLAlchemy type (so MySQL-isms like TINYINT /
DATETIME become portable), then compile a CREATE TABLE for the *target* dialect
(e.g. Postgres → INTEGER / VARCHAR / TIMESTAMP / NUMERIC). Preview it, or run it.
"""
from __future__ import annotations

import sqlalchemy as sa

from .connectors.base import Connector


def _generic_type(coltype: sa.types.TypeEngine) -> sa.types.TypeEngine:
    """Best-effort dialect-neutral type; falls back to TEXT for exotic types."""
    try:
        return coltype.as_generic()
    except Exception:
        return sa.Text()


def generate_create_table_ddl(
    source: Connector, source_schema: str, source_table: str,
    target: Connector, target_schema: str, target_table: str,
) -> str:
    src = source._table(source_schema, source_table)
    pk = {c.name for c in src.primary_key.columns}
    meta = sa.MetaData()
    cols = [
        sa.Column(c.name, _generic_type(c.type), nullable=c.nullable, primary_key=(c.name in pk))
        for c in src.columns
    ]
    # SQLite target has no real schemas; other dialects keep the schema qualifier.
    schema = target_schema if (target_schema and target.engine.dialect.name != "sqlite") else None
    tbl = sa.Table(target_table, meta, *cols, schema=schema)
    ddl = str(sa.schema.CreateTable(tbl).compile(target.engine)).strip()
    return ddl + ";"


def create_target_table(
    source: Connector, source_schema: str, source_table: str,
    target: Connector, target_schema: str, target_table: str,
    execute: bool = False,
) -> dict:
    ddl = generate_create_table_ddl(source, source_schema, source_table, target, target_schema, target_table)
    created = False
    if execute:
        if getattr(target.profile, "read_only", False):
            raise ValueError("Target connection is read-only. Turn off read-only mode to create tables.")
        with target.engine.begin() as conn:
            conn.execute(sa.text(ddl))
        created = True
    return {"ddl": ddl, "created": created}
