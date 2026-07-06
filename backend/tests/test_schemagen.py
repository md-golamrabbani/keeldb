"""Auto-generate target table (DDL translation) from a source table."""
import sqlalchemy as sa

from app import schemagen
from app.models import SavedConnection
from app.connectors import connector_for

SRC = """
CREATE TABLE person (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  salary NUMERIC(10,2),
  active INTEGER,
  created TIMESTAMP
)
"""


def _pg_connector():
    # Never connects — used only for its dialect when compiling DDL.
    return connector_for(SavedConnection(id="pg", name="pg", flavor="postgresql",
                                         host="127.0.0.1", port=5432, database="d", user="u", password="p"))


def test_generate_ddl_for_postgres(make_conn):
    src = make_conn(SRC)
    pg = _pg_connector()
    try:
        ddl = schemagen.generate_create_table_ddl(src, "main", "person", pg, "public", "person")
    finally:
        src.dispose(); pg.dispose()
    assert "CREATE TABLE" in ddl and "person" in ddl
    assert "PRIMARY KEY (id)" in ddl
    # portable types rendered for Postgres (no SQLite/MySQL-isms); autoincrement
    # integer PK becomes SERIAL, datetime becomes TIMESTAMP.
    assert "SERIAL" in ddl and "NUMERIC(10, 2)" in ddl and "TIMESTAMP" in ddl
    assert "name TEXT NOT NULL" in ddl


def test_generate_and_create_on_target(make_conn, tmp_path):
    src = make_conn(SRC)
    # a separate empty SQLite as the target
    tgt_path = str(tmp_path / "tgt.db")
    sa.create_engine(f"sqlite:///{tgt_path}").dispose()  # touch file
    tgt = connector_for(SavedConnection(id="t", name="t", flavor="sqlfile", database="main", sqlite_path=tgt_path))
    try:
        res = schemagen.create_target_table(src, "main", "person", tgt, "main", "person_copy", execute=True)
        assert res["created"] and "CREATE TABLE" in res["ddl"]
        cols = {c.name for c in tgt.list_columns("main", "person_copy")}
        assert cols == {"id", "name", "salary", "active", "created"}
        pk = [c.name for c in tgt.list_columns("main", "person_copy") if c.is_pk]
        assert pk == ["id"]
    finally:
        src.dispose(); tgt.dispose()


def test_create_blocked_when_target_read_only(make_conn, tmp_path):
    src = make_conn(SRC)
    tgt_path = str(tmp_path / "ro.db")
    sa.create_engine(f"sqlite:///{tgt_path}").dispose()
    tgt = connector_for(SavedConnection(id="t", name="t", flavor="sqlfile", database="main",
                                        sqlite_path=tgt_path, read_only=True))
    try:
        import pytest
        with pytest.raises(ValueError):
            schemagen.create_target_table(src, "main", "person", tgt, "main", "x", execute=True)
    finally:
        src.dispose(); tgt.dispose()
