"""Post-migration verification: FK orphan scan + row-count reconcile."""
import sqlalchemy as sa

from app import verify
from app.models import SavedConnection
from app.connectors import connector_for


CLEAN = """
CREATE TABLE dept (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE emp (id INTEGER PRIMARY KEY, name TEXT, dept_id INTEGER REFERENCES dept(id));
INSERT INTO dept VALUES (1,'Eng'),(2,'HR');
INSERT INTO emp VALUES (1,'A',1),(2,'B',2),(3,'C',NULL)
"""


def test_orphan_scan_clean(make_conn):
    c = make_conn(CLEAN)
    res = verify.orphan_scan(c, "main")
    c.dispose()
    assert res["total_orphans"] == 0
    emp = next(t for t in res["tables"] if t["table"] == "emp")
    assert emp["checks"][0]["ref_table"] == "dept" and emp["checks"][0]["orphans"] == 0


def test_orphan_scan_detects_orphans(make_conn):
    c = make_conn(CLEAN)
    # inject two orphans: emp rows pointing at a non-existent dept
    with c.engine.begin() as conn:
        conn.execute(sa.text("INSERT INTO emp VALUES (4,'D',99),(5,'E',88)"))
    res = verify.orphan_scan(c, "main", "emp")
    c.dispose()
    assert res["total_orphans"] == 2
    assert res["tables"][0]["checks"][0]["orphans"] == 2


def test_reconcile_counts(make_conn, tmp_path):
    src = make_conn(CLEAN)  # emp has 3 rows
    # target with a different emp count
    tgt_path = str(tmp_path / "t.db")
    e = sa.create_engine(f"sqlite:///{tgt_path}")
    with e.begin() as conn:
        conn.execute(sa.text("CREATE TABLE emp (id INTEGER PRIMARY KEY, name TEXT)"))
        conn.execute(sa.text("INSERT INTO emp VALUES (1,'A'),(2,'B')"))  # only 2
    e.dispose()
    tgt = connector_for(SavedConnection(id="t", name="t", flavor="sqlfile", database="main", sqlite_path=tgt_path))
    try:
        r = verify.reconcile_counts(src, "main", "emp", tgt, "main", "emp")
        assert r["source"] == 3 and r["target"] == 2 and r["diff"] == -1 and r["match"] is False
    finally:
        src.dispose(); tgt.dispose()
