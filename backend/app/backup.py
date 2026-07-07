"""Table backup — dump a table's schema + data as a portable .sql script.

Emits a CREATE TABLE followed by one INSERT per row, with values rendered as
dialect-correct literals by SQLAlchemy (no hand-rolled escaping). Restoring is
just running the script back through the SQL editor / import.
"""
from __future__ import annotations

import sqlalchemy as sa

from .connectors.base import Connector


def backup_table(connector: Connector, schema: str, table: str) -> dict:
    t = connector._table(schema, table)
    ddl = str(sa.schema.CreateTable(t).compile(connector.engine)).strip()
    lines = [ddl.rstrip(";") + ";", ""]

    count = 0
    with connector.engine.connect() as conn:
        for row in conn.execute(sa.select(t)).mappings():
            stmt = t.insert().values(**dict(row))
            sql = str(stmt.compile(connector.engine, compile_kwargs={"literal_binds": True}))
            lines.append(sql.rstrip(";") + ";")
            count += 1

    return {"table": table, "rows": count, "sql": "\n".join(lines) + "\n"}
