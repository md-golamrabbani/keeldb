"""Query performance analyzer — SQLite EXPLAIN parsing + hint generation + guards."""
import pytest

from app import explain

SEED = """
CREATE TABLE dept (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE emp (id INTEGER PRIMARY KEY, name TEXT, dept_id INTEGER, email TEXT);
CREATE INDEX ix_emp_dept ON emp(dept_id);
INSERT INTO dept VALUES (1,'Eng'),(2,'HR');
INSERT INTO emp VALUES (1,'A',1,'a@x.com'),(2,'B',1,'b@x.com'),(3,'C',2,'c@x.com')
"""


def test_full_table_scan_flagged(make_conn):
    c = make_conn(SEED)
    res = explain.analyze_query(c, "SELECT * FROM emp WHERE email = 'a@x.com'")
    c.dispose()
    assert res["dialect"] == "sqlite"
    assert "emp" in res["scans"]
    assert any(h["level"] == "warn" and h["table"] == "emp" for h in res["hints"])


def test_indexed_lookup_not_flagged(make_conn):
    c = make_conn(SEED)
    # dept_id is indexed → SEARCH USING INDEX, not a full scan
    res = explain.analyze_query(c, "SELECT * FROM emp WHERE dept_id = 1")
    c.dispose()
    assert res["scans"] == []
    assert any(h["level"] == "info" for h in res["hints"])


def test_primary_key_lookup_clean(make_conn):
    c = make_conn(SEED)
    res = explain.analyze_query(c, "SELECT * FROM emp WHERE id = 2")
    c.dispose()
    assert res["scans"] == []


def test_order_by_temp_btree_hint(make_conn):
    c = make_conn(SEED)
    res = explain.analyze_query(c, "SELECT * FROM emp ORDER BY name")
    c.dispose()
    assert any("ORDER BY" in h["message"] for h in res["hints"])


def test_plan_text_present(make_conn):
    c = make_conn(SEED)
    res = explain.analyze_query(c, "SELECT * FROM emp")
    c.dispose()
    assert res["plan_text"] and isinstance(res["plan"], list) and len(res["plan"]) >= 1


def test_rejects_writes(make_conn):
    c = make_conn(SEED)
    try:
        with pytest.raises(ValueError):
            explain.analyze_query(c, "DELETE FROM emp WHERE id = 1")
        with pytest.raises(ValueError):
            explain.analyze_query(c, "UPDATE emp SET name='x'")
    finally:
        c.dispose()


def test_rejects_multiple_statements(make_conn):
    c = make_conn(SEED)
    try:
        with pytest.raises(ValueError):
            explain.analyze_query(c, "SELECT * FROM emp; SELECT * FROM dept")
    finally:
        c.dispose()


def test_trailing_semicolon_ok(make_conn):
    c = make_conn(SEED)
    res = explain.analyze_query(c, "SELECT * FROM emp;")
    c.dispose()
    assert res["sql"] == "SELECT * FROM emp"
