"""Table backup — schema + data dump, restorable."""
import sqlalchemy as sa

from app import backup


SEED = """
CREATE TABLE emp (id INTEGER PRIMARY KEY, name TEXT, salary REAL);
INSERT INTO emp VALUES (1,'Ann',100.5),(2,'O''Brien',200),(3,NULL,NULL)
"""


def test_backup_contains_ddl_and_inserts(make_conn):
    c = make_conn(SEED)
    res = backup.backup_table(c, "main", "emp")
    c.dispose()
    assert res["rows"] == 3
    assert "CREATE TABLE" in res["sql"] and res["sql"].count("INSERT INTO") == 3
    assert "O''Brien" in res["sql"]  # quote correctly escaped


def test_backup_database_covers_all_tables(make_conn):
    c = make_conn(SEED + "; CREATE TABLE dept (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO dept VALUES (1,'Eng')")
    res = backup.backup_database(c, "main")
    c.dispose()
    assert res["tables"] == 2 and res["rows"] == 4  # 3 emp + 1 dept
    assert "CREATE TABLE" in res["sql"] and res["sql"].count("CREATE TABLE") == 2
    assert "emp" in res["sql"] and "dept" in res["sql"]


def test_backup_is_restorable(make_conn, tmp_path):
    c = make_conn(SEED)
    sql = backup.backup_table(c, "main", "emp")["sql"]
    c.dispose()
    # restore into a fresh database and verify the rows come back
    e = sa.create_engine(f"sqlite:///{tmp_path / 'restore.db'}")
    with e.begin() as conn:
        for stmt in filter(None, (s.strip() for s in sql.split(";"))):
            conn.execute(sa.text(stmt))
    with e.connect() as conn:
        n = conn.execute(sa.text("SELECT count(*) FROM emp")).scalar()
        name = conn.execute(sa.text("SELECT name FROM emp WHERE id=2")).scalar()
    e.dispose()
    assert n == 3 and name == "O'Brien"
