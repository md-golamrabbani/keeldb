"""Admin/DDL ops + read-only guard, on SQLite."""
import pytest

from app import admin, dbops

SEED = """
CREATE TABLE dept (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE emp (id INTEGER PRIMARY KEY, name TEXT, dept_id INTEGER REFERENCES dept(id));
INSERT INTO dept VALUES (1,'Eng'),(2,'HR');
INSERT INTO emp VALUES (1,'A',1),(2,'B',2);
CREATE TRIGGER trg AFTER INSERT ON emp BEGIN SELECT 1; END
"""


def test_table_ddl(make_conn):
    c = make_conn(SEED); ddl = admin.table_ddl(c, "main", "dept"); c.dispose()
    assert "CREATE TABLE" in ddl["ddl"] and "id" in ddl["ddl"]


def test_schema_graph_relationships(make_conn):
    c = make_conn(SEED); g = admin.schema_graph(c, "main"); c.dispose()
    names = {t["name"] for t in g["tables"]}
    assert {"dept", "emp"} <= names
    assert any(r["from_table"] == "emp" and r["to_table"] == "dept" for r in g["relationships"])


def test_table_and_column_lifecycle(make_conn):
    c = make_conn(SEED); admin.create_table(c, "main", "proj", [
        {"name": "id", "type": "INTEGER", "nullable": False, "pk": True},
        {"name": "title", "type": "TEXT", "nullable": True, "pk": False},
    ]); c.dispose()
    c = make_conn(SEED); admin.add_column(c, "main", "proj", "budget", "NUMERIC"); c.dispose()
    c = make_conn(SEED); admin.rename_column(c, "main", "proj", "title", "proj_name"); c.dispose()
    c = make_conn(SEED); cols = {col.name for col in c.list_columns("main", "proj")}; c.dispose()
    assert {"id", "proj_name", "budget"} == cols
    c = make_conn(SEED); admin.drop_column(c, "main", "proj", "budget"); c.dispose()
    c = make_conn(SEED); admin.rename_table(c, "main", "proj", "projects"); c.dispose()
    c = make_conn(SEED); tables = {t.name for t in c.list_tables("main")}; c.dispose()
    assert "projects" in tables and "proj" not in tables
    c = make_conn(SEED); admin.drop_table(c, "main", "projects"); c.dispose()
    c = make_conn(SEED); assert "projects" not in {t.name for t in c.list_tables("main")}; c.dispose()


def test_truncate(make_conn):
    c = make_conn(SEED); admin.truncate_table(c, "main", "emp"); c.dispose()
    c = make_conn(SEED); assert dbops.read_table(c, "main", "emp")["total"] == 0; c.dispose()


def test_triggers_listed(make_conn):
    c = make_conn(SEED); trg = admin.list_triggers(c, "main"); c.dispose()
    assert any("trg" in str(row[0]) for row in trg["rows"])


def test_privileges_sqlite_note(make_conn):
    c = make_conn(SEED); priv = admin.list_privileges(c, "main"); c.dispose()
    assert priv.get("note")


def test_create_database_guarded_on_sqlite(make_conn):
    c = make_conn(SEED)
    with pytest.raises(ValueError):
        admin.create_database(c, "newdb")
    c.dispose()


def test_read_only_blocks_ddl(make_conn):
    c = make_conn(SEED, read_only=True)
    with pytest.raises(ValueError):
        admin.drop_table(c, "main", "emp")
    c.dispose()
